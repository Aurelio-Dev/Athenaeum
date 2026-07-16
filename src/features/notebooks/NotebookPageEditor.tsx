import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  deleteNotebookFileAttachment,
  loadNotebookAssets,
  openNotebookFileAttachment,
  revealNotebookFileAttachment,
  saveNotebookAsset,
  saveNotebookFileAttachment,
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
  findClosestCallout,
  getCalloutType,
  normalizeCallouts,
  setCalloutType,
} from "./notebookEditorCalloutDom";
import {
  clearDiagramScaleRuntimeStyles,
  findClosestDiagram,
  findClosestDiagramSource,
  getDiagramKind,
  getDiagramSource,
  normalizeDiagrams,
  resolveDiagramSourceEnterAction,
  setDiagramKind,
} from "./notebookEditorDiagramDom";
import {
  diagramScaleDefaultPercent,
  parseDiagramScale,
  parseEquationScale,
  parseFigureScale,
  resizableScaleDefaultPercent,
} from "./notebookDiagramScale";
import { applyFigureDimensions, parseFigureDimensions } from "./notebookFigureDimensions";
import {
  clearEquationRuntimeClasses,
  clearEquationPreviews,
  findClosestEquation,
  getEquationSource,
  notebookEquationActiveClassName,
  notebookEquationCleanModeClassName,
  normalizeEquations,
} from "./notebookEditorEquationDom";
import {
  clearFigurePreviews,
  hydrateNotebookAssetImages,
  normalizeFigures,
  removeNotebookAssetImageSources,
} from "./notebookEditorFigureDom";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
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
  toolbarButtons,
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
  isPlaceholderFigureCaption,
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
  isCleanMode: boolean;
};

// Onde o cursor deve parar depois que a tabela e reinserida por
// applyTableStructureChange (a tabela vira nós novos, entao a posicao e por
// indice, nao por referencia de no).
type TableCaretTarget = {
  rowIndex: number;
  columnIndex: number;
};

type ActiveCalloutControls = {
  top: number;
  left: number;
  type: CalloutType;
};

type ActiveEquationControls = {
  top: number;
  left: number;
  isCleanMode: boolean;
};

type ActiveDiagramControls = {
  top: number;
  left: number;
  kind: DiagramKind;
};

// Item da estrutura compartilhada de insercao de blocos: alimenta a secao
// "Inserir" do menu "..." e o menu inline "/". `keywords` sao termos extras
// (sem acento) so para o filtro do "/".
type NotebookInsertMenuItem = {
  id: string;
  label: string;
  keywords: string[];
  section: "insert" | "diagram" | "reference";
  icon: JSX.Element;
  run: () => void;
};

// Estado de render do menu "/": posicao relativa ao shell do editor, query
// digitada apos o "/" e item destacado pelo teclado. O ponto exato do "/"
// (no de texto + offset) fica em slashAnchorRef — detalhe de DOM, nao de
// render.
type SlashMenuControls = {
  top: number;
  left: number;
  query: string;
  selectedIndex: number;
};

export type NotebookSpacingMode = "compact" | "normal" | "comfortable" | "wide";
type NotebookToolbarVariant = "default" | "focus";
type TextStyleCommand = "paragraph" | "h1" | "h2" | "h3";
type AlignmentCommand = "justifyLeft" | "justifyCenter" | "justifyRight" | "justifyFull";

const textStyleOptions: Array<{ command: TextStyleCommand; label: string }> = [
  { command: "paragraph", label: "Texto normal" },
  { command: "h1", label: "Título 1" },
  { command: "h2", label: "Título 2" },
  { command: "h3", label: "Título 3" },
];

const alignmentOptions: Array<{ command: AlignmentCommand; label: string }> = [
  { command: "justifyLeft", label: "Alinhar à esquerda" },
  { command: "justifyCenter", label: "Centralizar" },
  { command: "justifyRight", label: "Alinhar à direita" },
  { command: "justifyFull", label: "Justificar" },
];

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

const diagramInsertSubtypes: Array<Exclude<FigureSubtype, "image">> = ["diagram", "graph-diagram", "flowchart"];

// Largura aproximada da toolbar flutuante de selecao — usada so para clampar a
// posicao horizontal dentro da viewport (a barra e centrada no trecho).
const notebookSelectionToolbarWidth = 380;

const notebookSlashMenuWidth = 236;
// Altura estimada (itens + rotulo + padding) usada so na decisao de flip
// vertical na abertura — a altura real e limitada por maxHeight com scroll.
const notebookSlashMenuEstimatedHeight = 360;

// Filtro do menu "/" ignora acentos e caixa ("equacao" encontra "Equação").
function normalizeSlashFilterText(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function getToolbarButton(action: EditorAction) {
  const button = toolbarButtons.find((candidate) => candidate.action === action);

  if (!button) {
    throw new Error(`Botão da toolbar não encontrado: ${action}`);
  }

  return button;
}

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

export function serializeNotebookEditorHtml(editor: HTMLElement) {
  const clone = editor.cloneNode(true) as HTMLElement;

  clearEquationRuntimeClasses(clone);
  clearTableRuntimeClasses(clone);
  normalizeDiagrams(clone);
  // O HTML salvo carrega apenas data-diagram-scale: nenhuma variável CSS
  // runtime, transform, dimensão medida ou handle sobrevive à serialização.
  clearDiagramScaleRuntimeStyles(clone);
  normalizeEquations(clone);
  normalizeFigures(clone);
  normalizeFileAttachmentCards(clone);
  clearEquationPreviews(clone);
  clearFigurePreviews(clone);
  removeNotebookAssetImageSources(clone);
  clearFileAttachmentControls(clone);

  return clone.innerHTML;
}

function appendTrailingClipboardBlock(wrapper: HTMLElement) {
  const trailingBlock = document.createElement("div");
  trailingBlock.appendChild(document.createElement("br"));
  wrapper.append(trailingBlock);
}

function appendSanitizedDiagramClipboardBlock(wrapper: HTMLElement, diagram: HTMLElement) {
  const kind = getDiagramKind(diagram);
  const sourceText = getDiagramSource(diagram)?.textContent ?? "";
  const scale = parseDiagramScale(diagram.dataset.diagramScale);
  const pastedDiagram = document.createElement("figure");
  const preview = document.createElement("div");
  const source = document.createElement("figcaption");

  pastedDiagram.dataset.athenaeumBlock = "diagram";
  pastedDiagram.dataset.diagramKind = kind;
  if (scale !== null && scale !== diagramScaleDefaultPercent) {
    pastedDiagram.dataset.diagramScale = String(scale);
  }

  preview.dataset.diagramPreview = "true";
  preview.contentEditable = "false";
  source.dataset.diagramSource = "true";
  source.spellcheck = false;
  source.setAttribute("spellcheck", "false");
  source.textContent = sourceText;
  pastedDiagram.append(preview, source);
  wrapper.append(pastedDiagram);
}

function appendSanitizedEquationClipboardBlock(wrapper: HTMLElement, equation: HTMLElement) {
  const sourceText = getEquationSource(equation)?.textContent ?? "";
  const scale = parseEquationScale(equation.dataset.equationScale);
  const pastedEquation = document.createElement("figure");
  const preview = document.createElement("div");
  const source = document.createElement("figcaption");

  pastedEquation.dataset.athenaeumBlock = "equation";
  pastedEquation.classList.remove(notebookEquationCleanModeClassName);
  if (scale !== null && scale !== resizableScaleDefaultPercent) {
    pastedEquation.dataset.equationScale = String(scale);
  }

  preview.dataset.equationPreview = "true";
  preview.contentEditable = "false";
  source.dataset.equationSource = "true";
  source.spellcheck = false;
  source.setAttribute("spellcheck", "false");
  source.textContent = sourceText;
  pastedEquation.append(preview, source);
  wrapper.append(pastedEquation);
}

function appendSanitizedFigureClipboardBlock(wrapper: HTMLElement, figure: HTMLElement) {
  const image = figure.querySelector<HTMLImageElement>(":scope > img[data-notebook-asset-id]");
  const assetId = image?.dataset.notebookAssetId;
  if (!image || !assetId) {
    return;
  }

  const scale = parseFigureScale(figure.dataset.figureScale);
  const dimensions = parseFigureDimensions(figure.dataset.figureWidth, figure.dataset.figureHeight);
  const pastedFigure = document.createElement("figure");
  const pastedImage = document.createElement("img");
  const caption = document.createElement("figcaption");

  pastedFigure.dataset.athenaeumBlock = "figure";
  pastedFigure.dataset.figureSubtype = "image";
  // Dimensoes independentes validas tem prioridade; senao cai na escala legada.
  // Valores externos invalidos viram null aqui e a figura fica no tamanho natural.
  if (dimensions) {
    applyFigureDimensions(pastedFigure, dimensions);
  } else if (scale !== null && scale !== resizableScaleDefaultPercent) {
    pastedFigure.dataset.figureScale = String(scale);
  }

  pastedImage.dataset.notebookAssetId = assetId;
  pastedImage.alt = image.getAttribute("alt") ?? "";
  const sourceCaption = figure.querySelector(":scope > figcaption")?.textContent ?? "";
  caption.textContent = isPlaceholderFigureCaption(sourceCaption) ? "" : sourceCaption;
  pastedFigure.append(pastedImage, caption);
  wrapper.append(pastedFigure);
}

export function createSanitizedNotebookClipboardHtml(html: string) {
  if (html.trim().length === 0) {
    return null;
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  clearEquationRuntimeClasses(template.content);

  const richBlocks = Array.from(
    template.content.querySelectorAll<HTMLElement>(
      [
        '[data-athenaeum-block="diagram"]',
        '[data-athenaeum-block="equation"]',
        '[data-athenaeum-block="figure"][data-figure-subtype="image"]',
      ].join(","),
    ),
  );
  if (richBlocks.length === 0) {
    return null;
  }

  const wrapper = document.createElement("div");
  richBlocks.forEach((block) => {
    const blockType = block.dataset.athenaeumBlock;
    if (blockType === "diagram") {
      appendSanitizedDiagramClipboardBlock(wrapper, block);
    } else if (blockType === "equation") {
      appendSanitizedEquationClipboardBlock(wrapper, block);
    } else if (blockType === "figure") {
      appendSanitizedFigureClipboardBlock(wrapper, block);
    }
  });

  if (wrapper.childElementCount === 0) {
    return null;
  }

  appendTrailingClipboardBlock(wrapper);

  return wrapper.innerHTML;
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

// Modo limpo da tabela: classe de RUNTIME, igual a da equacao. Nunca e
// persistida — serializeNotebookEditorHtml a remove do clone e a carga inicial
// a limpa do editor, entao alternar o modo nao suja o HTML salvo nem o export.
export const notebookTableCleanModeClassName = "notebook-table--clean-mode";

export function clearTableRuntimeClasses(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-athenaeum-block="table"]').forEach((table) => {
    table.classList.remove(notebookTableCleanModeClassName);
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

// Achata o conteudo de um no em texto puro, tratando <br> como "\n" — os dois
// modelos de quebra de linha que o Chromium usa dentro de contentEditable:
// elementos <br> (callout) ou caracteres "\n" reais dentro de um no de texto
// (blocos com white-space:pre, como o de codigo — ali o navegador usa \n em
// vez de <br>). Precisa tratar os dois porque Range.toString() ignora <br>
// silenciosamente, e teria juntado linhas inteiras sem separador.
function flattenLineBreaks(node: Node): string {
  if (node instanceof HTMLBRElement) {
    return "\n";
  }

  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? "";
  }

  return Array.from(node.childNodes).map(flattenLineBreaks).join("");
}

// O caret esta no fim de `root` E a "linha atual" (o trecho depois da ultima
// quebra, ou o conteudo inteiro se nao houver nenhuma) esta vazia?
//
// Usado pelos blocos multi-linha (callout, "codigo") para decidir Enter
// simples: se a ultima linha ja esta vazia, o Enter sai do bloco em vez de
// abrir mais uma quebra — a mesma convencao de "Enter duplo sai" de editores
// como Notion/Obsidian, que preserva Enter normal para digitar varias linhas
// e ainda da uma saida sem exigir Shift+Enter para tudo.
function isCaretOnEmptyTrailingLine(root: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (range.startContainer !== root && !root.contains(range.startContainer)) {
    return false;
  }

  const beforeCaretRange = document.createRange();
  beforeCaretRange.selectNodeContents(root);
  beforeCaretRange.setEnd(range.startContainer, range.startOffset);

  const textBeforeCaret = flattenLineBreaks(beforeCaretRange.cloneContents());
  const fullText = flattenLineBreaks(root);

  // O Chromium abre uma linha em branco com uma quebra DUPLICADA (dois <br>,
  // ou "\n\n" no modelo de texto): a quebra real e um "filler" logo depois so
  // para dar altura a linha vazia — com o caret posicionado ANTES do filler,
  // nao depois. Por isso o "fim logico" do conteudo ignora uma unica quebra
  // final, se houver, e o caret pode estar tanto ali quanto no fim bruto.
  const logicalEnd = fullText.endsWith("\n") ? fullText.slice(0, -1) : fullText;

  if (textBeforeCaret !== fullText && textBeforeCaret !== logicalEnd) {
    return false;
  }

  const lastLine = logicalEnd.slice(logicalEnd.lastIndexOf("\n") + 1);
  return lastLine.length === 0;
}

// Remove a quebra que abriu a linha em branco — e o "filler" que o Chromium
// insere logo depois dela so para dar altura a linha vazia (mesmo par que
// isCaretOnEmptyTrailingLine ja considera "fim logico" do conteudo) — chamado
// so quando essa linha vai virar a saida do bloco. Sem isso, sair deixaria uma
// linha extra em branco dentro do callout/codigo. Cobre os dois modelos:
// <br> como elementos (callout) ou "\n" dentro de um no de texto (codigo,
// white-space:pre). Assume que a quebra de texto vive num unico no de texto
// no final — o caso observado na pratica; um bloco de codigo fragmentado em
// varios nos de texto por outra via ficaria fora deste alcance.
function trimTrailingBlankLine(root: HTMLElement) {
  const children = Array.from(root.childNodes);
  const lastChild = children[children.length - 1];

  if (lastChild instanceof HTMLBRElement) {
    let lastBreakIndex = -1;
    for (let index = children.length - 2; index >= 0; index -= 1) {
      if (children[index] instanceof HTMLBRElement) {
        lastBreakIndex = index;
        break;
      }
    }

    children.slice(lastBreakIndex < 0 ? children.length - 1 : lastBreakIndex).forEach((node) => node.remove());
    return;
  }

  if (lastChild?.nodeType === Node.TEXT_NODE && (lastChild.textContent ?? "").endsWith("\n")) {
    const withoutFiller = (lastChild.textContent ?? "").slice(0, -1);
    const lastBreakIndex = withoutFiller.lastIndexOf("\n");
    lastChild.textContent = lastBreakIndex >= 0 ? withoutFiller.slice(0, lastBreakIndex) : "";
  }
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
  const activeEquationElementRef = useRef<HTMLElement | null>(null);
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const localImageInputRef = useRef<HTMLInputElement | null>(null);
  const localAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const zoomScale = zoomPercent / 100;
  const toolbarVariant: NotebookToolbarVariant = isFocusMode ? "focus" : "default";
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
  const [isListMenuOpen, setIsListMenuOpen] = useState(false);
  const [isReferenceMenuOpen, setIsReferenceMenuOpen] = useState(false);
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false);
  const [isCiteMenuOpen, setIsCiteMenuOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [activeAlignment, setActiveAlignment] = useState<AlignmentCommand | null>(null);
  const [isSelectionInLink, setIsSelectionInLink] = useState(false);
  const [showAttachmentNotice, setShowAttachmentNotice] = useState(false);
  const [assetPasteError, setAssetPasteError] = useState<string | null>(null);
  const [activeTableCell, setActiveTableCell] = useState<ActiveTableCellControls | null>(null);
  const [activeCallout, setActiveCallout] = useState<ActiveCalloutControls | null>(null);
  const [activeDiagram, setActiveDiagram] = useState<ActiveDiagramControls | null>(null);
  const [isDiagramCleanMode, setIsDiagramCleanMode] = useState(false);
  const [activeEquation, setActiveEquation] = useState<ActiveEquationControls | null>(null);
  const [isEmpty, setIsEmpty] = useState(initialNotebookContentIsEmpty(initialContent));

  // Toolbar flutuante de formatacao: aparece ancorada acima da selecao de
  // texto (nao ha mais barra fixa). Guardamos o retangulo da selecao em
  // coordenadas de viewport — a barra e position:fixed, como no protótipo.
  const [selectionToolbarRect, setSelectionToolbarRect] = useState<{ top: number; left: number } | null>(null);

  // Menu "/" de insercao inline de blocos.
  const [slashMenu, setSlashMenu] = useState<SlashMenuControls | null>(null);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const slashSelectedItemRef = useRef<HTMLButtonElement | null>(null);
  // Posicao do caractere "/" que abriu o menu. A flag pendente existe porque
  // o keydown valida o contexto ANTES de o caractere existir no DOM — o menu
  // so abre no input seguinte, depois de confirmar que o "/" foi inserido.
  const slashAnchorRef = useRef<{ node: Text; offset: number } | null>(null);
  const pendingSlashTriggerRef = useRef(false);

  useEffect(() => {
    setIsTextMenuOpen(false);
    setIsListMenuOpen(false);
    setIsLinkPopoverOpen(false);
    setIsCiteMenuOpen(false);
    setIsMoreMenuOpen(false);
    // Troca de variante muda paddings/larguras — a posicao ancorada do "/"
    // ficaria errada; fecha em vez de reposicionar.
    setSlashMenu(null);
    slashAnchorRef.current = null;
    pendingSlashTriggerRef.current = false;
  }, [toolbarVariant]);

  // Enquanto um menu/popover DA PROPRIA toolbar flutuante esta aberto, a barra
  // nao pode sumir: o popover de link (e o de citacao) move o foco para fora do
  // editor, colapsando a selecao — sem este guard a barra sumiria levando o
  // popover junto. Ref (e nao state) porque syncActiveActions le no momento do
  // evento de selecao.
  const isToolbarUiOpen =
    isTextMenuOpen || isListMenuOpen || isMoreMenuOpen || isLinkPopoverOpen || isCiteMenuOpen || showAttachmentNotice || Boolean(assetPasteError);
  const isToolbarUiOpenRef = useRef(false);
  isToolbarUiOpenRef.current = isToolbarUiOpen;

  const syncActiveActions = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const isSelectionInEditor = Boolean(
      editor && selection && selection.rangeCount > 0 && selection.anchorNode && editor.contains(selection.anchorNode),
    );

    if (!isSelectionInEditor || !editor || !selection) {
      activeEquationElementRef.current?.classList.remove(notebookEquationActiveClassName);
      activeEquationElementRef.current = null;
      setActiveActions(new Set());
      setActiveAlignment(null);
      setIsSelectionInLink(false);
      setActiveTableCell(null);
      setActiveCallout(null);
      setActiveDiagram(null);
      setActiveEquation(null);
      if (!isToolbarUiOpenRef.current) {
        setSelectionToolbarRect(null);
      }
      return;
    }

    // Toolbar flutuante: so com trecho selecionado (caret sozinho nao mostra).
    if (selection.isCollapsed) {
      if (!isToolbarUiOpenRef.current) {
        setSelectionToolbarRect(null);
      }
    } else {
      const selectionRect = selection.getRangeAt(0).getBoundingClientRect();
      if (selectionRect.width > 0 || selectionRect.height > 0) {
        // A barra e centrada no trecho (translateX(-50%)); sem clamp ela vaza
        // pelas bordas quando a selecao fica perto delas.
        const halfWidth = notebookSelectionToolbarWidth / 2;
        const centeredLeft = selectionRect.left + selectionRect.width / 2;
        setSelectionToolbarRect({
          top: selectionRect.top,
          left: Math.min(Math.max(centeredLeft, halfWidth + 8), window.innerWidth - halfWidth - 8),
        });
      }
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

    setIsSelectionInLink(Boolean(
      findEnclosingTag(selection.anchorNode, "a", editor) || findEnclosingTag(selection.focusNode, "a", editor),
    ));

    if (document.queryCommandState("justifyCenter")) {
      setActiveAlignment("justifyCenter");
    } else if (document.queryCommandState("justifyRight")) {
      setActiveAlignment("justifyRight");
    } else if (document.queryCommandState("justifyFull")) {
      setActiveAlignment("justifyFull");
    } else {
      setActiveAlignment("justifyLeft");
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
        isCleanMode: tableCellInfo.table.classList.contains(notebookTableCleanModeClassName),
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
      const maxLeft = Math.max(8, shellRect.width - 540);

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
      if (activeEquationElementRef.current !== equation) {
        activeEquationElementRef.current?.classList.remove(notebookEquationActiveClassName);
      }
      equation.classList.add(notebookEquationActiveClassName);
      activeEquationElementRef.current = equation;

      const shellRect = editorShell.getBoundingClientRect();
      const equationRect = equation.getBoundingClientRect();
      const maxLeft = Math.max(8, shellRect.width - 320);

      setActiveEquation({
        top: Math.max(8, equationRect.top - shellRect.top - 38),
        left: Math.min(Math.max(8, equationRect.left - shellRect.left), maxLeft),
        isCleanMode: equation.classList.contains(notebookEquationCleanModeClassName),
      });
    } else {
      activeEquationElementRef.current?.classList.remove(notebookEquationActiveClassName);
      activeEquationElementRef.current = null;
      setActiveEquation(null);
    }

    setActiveActions(nextActive);
  }, []);

  // Conteudo inicial carregado uma unica vez — ver comentario nas props.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.innerHTML = initialContent;
      clearEquationRuntimeClasses(editor);
      clearTableRuntimeClasses(editor);
      normalizeCallouts(editor);
      normalizeDiagrams(editor);
      normalizeEquations(editor);
      normalizeFigures(editor);
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
      if (event.key === "Escape") {
        setIsTextMenuOpen(false);
        setIsListMenuOpen(false);
        setIsReferenceMenuOpen(false);
        setIsLayoutMenuOpen(false);
        setIsLinkPopoverOpen(false);
        setIsCiteMenuOpen(false);
        setIsMoreMenuOpen(false);
        setShowAttachmentNotice(false);
        setAssetPasteError(null);
        return;
      }

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
    if (!isTextMenuOpen && !isListMenuOpen && !isReferenceMenuOpen && !isLayoutMenuOpen && !isLinkPopoverOpen && !isCiteMenuOpen && !isMoreMenuOpen && !showAttachmentNotice && !assetPasteError && !slashMenu) {
      return;
    }

    function handlePointerDown(event: globalThis.MouseEvent) {
      if (event.target instanceof Node && (toolbarRef.current?.contains(event.target) || slashMenuRef.current?.contains(event.target))) {
        return;
      }

      setIsTextMenuOpen(false);
      setIsListMenuOpen(false);
      setIsReferenceMenuOpen(false);
      setIsLayoutMenuOpen(false);
      setIsLinkPopoverOpen(false);
      setIsCiteMenuOpen(false);
      setIsMoreMenuOpen(false);
      setShowAttachmentNotice(false);
      setAssetPasteError(null);
      setSlashMenu(null);
      slashAnchorRef.current = null;
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isTextMenuOpen, isListMenuOpen, isReferenceMenuOpen, isLayoutMenuOpen, isLinkPopoverOpen, isCiteMenuOpen, isMoreMenuOpen, showAttachmentNotice, assetPasteError, slashMenu]);

  // Caret saindo da regiao da query (clique, setas, Home/End) fecha o menu
  // "/". A validacao le o DOM direto (nao o estado) para nao depender da
  // ordem entre o commit do React e o disparo assincrono de selectionchange.
  useEffect(() => {
    if (!slashMenu) {
      return;
    }

    function handleSelectionChange() {
      if (readSlashQueryFromDom() === null) {
        closeSlashMenu();
      }
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slashMenu]);

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

  // ===== Menu "/" (insercao inline de blocos) =====

  function closeSlashMenu() {
    pendingSlashTriggerRef.current = false;
    slashAnchorRef.current = null;
    setSlashMenu(null);
  }

  // Contextos onde "/" e conteudo legitimo (codigo, fonte de diagrama,
  // equacao) nunca abrem o menu; fora deles, so vale como trigger no inicio
  // de bloco ou apos espaco — "https:/", "1/2" e "e/ou" seguem digitaveis.
  function isValidSlashTriggerContext() {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0 || !selection.isCollapsed) {
      return false;
    }

    const range = selection.getRangeAt(0);
    const container = range.startContainer;

    if (!editor.contains(container)) {
      return false;
    }

    if (findEnclosingTag(container, "code", editor)) {
      return false;
    }

    const diagram = findClosestDiagram(container, editor);
    if (diagram && findClosestDiagramSource(container, diagram)) {
      return false;
    }

    if (findClosestEquation(container, editor)) {
      return false;
    }

    if (container instanceof Text) {
      const textBeforeCaret = (container.textContent ?? "").slice(0, range.startOffset);
      // \s do JS ja cobre o nbsp (\u00A0), a forma comum de espaco em
      // contenteditable.
      return textBeforeCaret.length === 0 || /\s$/.test(textBeforeCaret);
    }

    // Caret direto num elemento (bloco vazio, ex. <div><br></div>).
    return true;
  }

  // Rect do caret com fallback para o rect do bloco pai: range colapsado em
  // bloco vazio devolve retangulo zerado.
  function getCaretRect() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0).cloneRange();
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0 || rect.top !== 0 || rect.left !== 0) {
      return rect;
    }

    const container = range.startContainer;
    const element = container instanceof HTMLElement ? container : container.parentElement;
    return element?.getBoundingClientRect() ?? null;
  }

  function computeSlashMenuPosition() {
    const editorShell = editorShellRef.current;
    const caretRect = getCaretRect();

    if (!editorShell || !caretRect) {
      return null;
    }

    const shellRect = editorShell.getBoundingClientRect();
    const maxLeft = Math.max(8, shellRect.width - notebookSlashMenuWidth - 8);
    const left = Math.min(Math.max(8, caretRect.left - shellRect.left), maxLeft);

    // Abaixo da linha do caret; perto da borda inferior do shell flipa para
    // cima — mesmo espirito de getNotebookOptionsMenuPosition.
    let top = caretRect.bottom - shellRect.top + 6;
    if (top + notebookSlashMenuEstimatedHeight > shellRect.height - 8) {
      top = Math.max(8, caretRect.top - shellRect.top - notebookSlashMenuEstimatedHeight - 6);
    }

    return { top, left };
  }

  // Deriva a query corrente do DOM (texto entre o "/" e o caret), ou null
  // quando alguma invariante quebrou e o menu deve fechar: no da ancora
  // removido, caret em outro no/antes do "/", "/" apagado, espaco na query.
  function readSlashQueryFromDom() {
    const anchor = slashAnchorRef.current;
    const selection = window.getSelection();

    if (!anchor || !anchor.node.isConnected || !selection || !selection.isCollapsed || selection.anchorNode !== anchor.node) {
      return null;
    }

    const text = anchor.node.textContent ?? "";
    const caretOffset = selection.anchorOffset;

    if (text[anchor.offset] !== "/" || caretOffset <= anchor.offset) {
      return null;
    }

    const query = text.slice(anchor.offset + 1, caretOffset);
    // Espaco encerra o modo menu: a partir dali o "/" vira texto comum.
    return /\s/.test(query) ? null : query;
  }

  // Abre o menu no input que inseriu o "/". A flag pendente e consumida
  // SEMPRE e o caractere e reconferido no DOM: um atalho tipo Ctrl+/ que nao
  // produz texto nao pode deixar a flag armada para um input posterior.
  function openSlashMenuFromPendingTrigger() {
    const selection = window.getSelection();
    const container = selection?.anchorNode ?? null;

    if (!selection || !selection.isCollapsed || !(container instanceof Text) || selection.anchorOffset === 0) {
      return;
    }

    const offset = selection.anchorOffset - 1;
    if ((container.textContent ?? "")[offset] !== "/") {
      return;
    }

    const position = computeSlashMenuPosition();
    if (!position) {
      return;
    }

    slashAnchorRef.current = { node: container, offset };
    setSlashMenu({ top: position.top, left: position.left, query: "", selectedIndex: 0 });
  }

  function syncSlashMenuQuery() {
    const query = readSlashQueryFromDom();

    if (query === null) {
      closeSlashMenu();
      return;
    }

    setSlashMenu((current) => (current && current.query !== query ? { ...current, query, selectedIndex: 0 } : current));
  }

  function handleInput() {
    emitChange();

    if (pendingSlashTriggerRef.current) {
      pendingSlashTriggerRef.current = false;
      openSlashMenuFromPendingTrigger();
      return;
    }

    if (slashAnchorRef.current) {
      syncSlashMenuQuery();
    }
  }

  function applySlashMenuItem(item: NotebookInsertMenuItem) {
    const anchor = slashAnchorRef.current;
    const query = slashMenu?.query ?? "";
    closeSlashMenu();

    // Deleta o trigger ("/" + query) e reposiciona caret e savedRangeRef ali
    // — os insert* existentes leem essa selecao, nada muda no caminho deles.
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (anchor && anchor.node.isConnected && editor && selection && editor.contains(anchor.node)) {
      const textLength = anchor.node.textContent?.length ?? 0;
      const deleteEnd = Math.min(anchor.offset + 1 + query.length, textLength);

      const range = document.createRange();
      range.setStart(anchor.node, anchor.offset);
      range.setEnd(anchor.node, deleteEnd);
      range.deleteContents();
      range.collapse(true);

      editor.focus();
      selection.removeAllRanges();
      selection.addRange(range);
      savedRangeRef.current = range.cloneRange();
      // Imagem/PDF nao inserem nada agora (dialogo assincrono): o texto do
      // trigger ja saiu do conteudo, entao o autosave precisa saber aqui.
      emitChange();
    }

    item.run();
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

  // Sobe do no ate o filho direto do editor (o "bloco de topo" daquele ponto).
  function getTopLevelBlock(node: Node, editor: HTMLElement) {
    let current = node instanceof Element ? node : node.parentElement;

    while (current && current.parentElement && current.parentElement !== editor) {
      current = current.parentElement;
    }

    return current && current.parentElement === editor && current instanceof HTMLElement ? current : null;
  }

  // Garante que o bloco novo nasca numa LINHA PROPRIA, filha do editor.
  //
  // Dois modos de falha que isto cobre:
  //  1. Cursor dentro de outro bloco (input da equacao, corpo do callout,
  //     celula): sem sair de la, o execCommand insere o bloco novo DENTRO do
  //     anterior. Aqui o cursor pula para a linha depois do bloco inteiro.
  //  2. Bloco de topo vazio: o menu "/" apaga o gatilho e deixa <div></div>
  //     sem <br>. O execCommand nao consegue escopar num bloco vazio e funde o
  //     conteudo com o bloco anterior — a mesma causa que impede o formatBlock
  //     de aplicar titulo pelo "/". O <br> devolve altura ao bloco e o escopo.
  function prepareBlockInsertionPoint() {
    const editor = editorRef.current;
    const selection = window.getSelection();

    if (!editor || !selection || selection.rangeCount === 0) {
      return;
    }

    const container = selection.getRangeAt(0).startContainer;
    const element = container instanceof Element ? container : container.parentElement;

    if (!element || !editor.contains(element)) {
      return;
    }

    const enclosingBlock = element.closest("[data-athenaeum-block]");
    if (enclosingBlock instanceof HTMLElement && editor.contains(enclosingBlock)) {
      const topBlock = getTopLevelBlock(enclosingBlock, editor);
      if (topBlock) {
        const { block } = getOrCreateEditableBlockAfter(topBlock);
        savedRangeRef.current = placeCursorAtEnd(block)?.cloneRange() ?? null;
        return;
      }
    }

    const topBlock = getTopLevelBlock(element, editor);
    if (!topBlock || topBlock.tagName.toLowerCase() !== "div") {
      return;
    }

    // Vazio "de verdade": apagar o gatilho deixa um no de texto vazio para
    // tras, entao childNodes.length nao serve como teste.
    const isEmpty = (topBlock.textContent ?? "").length === 0 && topBlock.firstElementChild === null;
    if (!isEmpty) {
      return;
    }

    topBlock.replaceChildren(document.createElement("br"));
    savedRangeRef.current = placeCursorAtEnd(topBlock)?.cloneRange() ?? null;
  }

  function insertBlockHtml(html: string) {
    restoreSavedRangeOrEditorEnd();
    prepareBlockInsertionPoint();
    insertHtml(html, { placeCursorInTrailingBlock: true });
    setIsTextMenuOpen(false);
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
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
          <div></div>
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
    // A legenda nasce vazia: o placeholder aparece so via CSS (:empty::before),
    // nunca como conteudo persistido. Assim uma imagem sem legenda e exportada
    // sem texto placeholder.
    insertHtml(`
      <figure data-athenaeum-block="figure" data-figure-subtype="image">
        <img data-notebook-asset-id="${escapeHtml(savedAsset.id)}" src="data:${escapeHtml(savedAsset.mimeType)};base64,${dataBase64}" alt="" />
        <figcaption></figcaption>
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
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
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
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
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

  // Aplica uma mudanca estrutural de tabela PELA pilha de desfazer nativa.
  //
  // Mutar a tabela direto no DOM (row.after, cell.remove, ...) e invisivel para
  // o historico do contentEditable: o Ctrl+Z seguinte reverte a entrada
  // anterior — a insercao da tabela — e destroi o bloco inteiro. Por isso a
  // mutacao roda num clone e a tabela e reinserida com execCommand, que grava
  // a operacao como um passo desfazivel.
  //
  // mutateClone recebe o clone e a posicao do cursor, e devolve onde o cursor
  // deve ficar depois da reinsercao (ou null para abortar).
  function applyTableStructureChange(
    mutateClone: (table: HTMLTableElement, rowIndex: number, columnIndex: number) => TableCaretTarget | null,
  ) {
    const editor = editorRef.current;
    const info = getCurrentTableCellInfo();
    const selection = window.getSelection();

    if (!editor || !info || !selection) {
      return;
    }

    const clone = info.table.cloneNode(true) as HTMLTableElement;
    const target = mutateClone(clone, info.rowIndex, info.columnIndex);
    if (!target) {
      return;
    }

    // A reinsercao troca a tabela no lugar, entao a posicao dela entre as
    // tabelas do editor nao muda — e assim que a reencontramos depois.
    const tables = Array.from(editor.querySelectorAll<HTMLTableElement>('table[data-athenaeum-block="table"]'));
    const tableIndex = tables.indexOf(info.table);

    const range = document.createRange();
    range.selectNode(info.table);
    editor.focus();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("insertHTML", false, clone.outerHTML);

    const insertedTables = Array.from(editor.querySelectorAll<HTMLTableElement>('table[data-athenaeum-block="table"]'));
    const insertedTable = tableIndex >= 0 ? insertedTables[tableIndex] : undefined;
    const targetCell = insertedTable?.rows.item(target.rowIndex)?.cells.item(target.columnIndex);

    if (targetCell instanceof HTMLTableCellElement) {
      commitTableMutation(targetCell);
      return;
    }

    emitChange();
    syncActiveActions();
  }

  function addTableRowBelow() {
    applyTableStructureChange((table, rowIndex, columnIndex) => {
      const row = table.rows.item(rowIndex);
      if (!row) {
        return null;
      }

      const columnCount = Math.max(...Array.from(table.rows).map((currentRow) => currentRow.cells.length), 0);
      const newRow = createEmptyTableRow(columnCount);
      row.after(newRow);

      return { rowIndex: rowIndex + 1, columnIndex: Math.min(columnIndex, Math.max(0, newRow.cells.length - 1)) };
    });
  }

  function removeCurrentTableRow() {
    const info = getCurrentTableCellInfo();
    if (!info || info.rowCount <= 1) {
      return;
    }

    applyTableStructureChange((table, rowIndex, columnIndex) => {
      const row = table.rows.item(rowIndex);
      if (!row || table.rows.length <= 1) {
        return null;
      }

      row.remove();

      // O cursor cai na linha que ocupou o lugar; se a removida era a ultima,
      // na anterior.
      const nextRowIndex = Math.min(rowIndex, table.rows.length - 1);
      const nextRow = table.rows.item(nextRowIndex);
      if (!nextRow) {
        return null;
      }

      return { rowIndex: nextRowIndex, columnIndex: Math.min(columnIndex, Math.max(0, nextRow.cells.length - 1)) };
    });
  }

  function addTableColumnRight() {
    applyTableStructureChange((table, rowIndex, columnIndex) => {
      Array.from(table.rows).forEach((row) => {
        const newCell = createEmptyTableCell();
        const referenceCell = row.cells.item(columnIndex);

        if (referenceCell) {
          referenceCell.after(newCell);
        } else {
          row.appendChild(newCell);
        }
      });

      return { rowIndex, columnIndex: columnIndex + 1 };
    });
  }

  function removeCurrentTableColumn() {
    const info = getCurrentTableCellInfo();
    if (!info || info.columnCount <= 1) {
      return;
    }

    applyTableStructureChange((table, rowIndex, columnIndex) => {
      Array.from(table.rows).forEach((row) => {
        row.cells.item(columnIndex)?.remove();
      });

      const row = table.rows.item(rowIndex);
      if (!row) {
        return null;
      }

      return { rowIndex, columnIndex: Math.min(columnIndex, Math.max(0, row.cells.length - 1)) };
    });
  }

  // Alterna so a tabela sob o cursor (nao todas), como no modo limpo da
  // equacao — o do diagrama e global porque vale para o editor inteiro.
  function toggleCurrentTableCleanMode() {
    const info = getCurrentTableCellInfo();
    if (!info) {
      return;
    }

    const shouldEnable = !info.table.classList.contains(notebookTableCleanModeClassName);
    info.table.classList.toggle(notebookTableCleanModeClassName, shouldEnable);
    syncActiveActions();
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

    // "Linha atual" = o filho direto de [data-callout-content] que contem o
    // caret (o corpo do callout, onde o texto realmente vive — "Destaque" e
    // um <strong> a parte). Enter simples na ultima linha vazia sai do
    // callout; em qualquer outro caso (linha com texto, ou Shift+Enter),
    // insere uma quebra normal, preservando o corpo multi-linha.
    const content = callout.querySelector<HTMLElement>('[data-callout-content="true"]');
    const caretNode = window.getSelection()?.anchorNode ?? null;
    const currentLine = content && caretNode ? getTopLevelBlock(caretNode, content) : null;

    if (!event.shiftKey && currentLine && isCaretOnEmptyTrailingLine(currentLine)) {
      trimTrailingBlankLine(currentLine);
      const { block, created } = getOrCreateEditableBlockAfter(callout);
      savedRangeRef.current = placeCursorAtEnd(block)?.cloneRange() ?? null;

      if (created) {
        emitChange();
      }

      syncActiveActions();
      return true;
    }

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
    const selection = window.getSelection();
    const source =
      diagram && selection?.anchorNode ? findClosestDiagramSource(selection.anchorNode, diagram) : null;

    const action = resolveDiagramSourceEnterAction({
      key: event.key,
      shiftKey: event.shiftKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      hasDiagram: Boolean(diagram),
      hasSourceCaret: Boolean(source && selection && selection.rangeCount > 0),
    });

    if (action === "ignore") {
      return false;
    }

    if (action === "insert-line-break") {
      // Uma unica quebra: insertLineBreak insere um <br> com sentinela e ja
      // posiciona o caret na proxima linha (mesmo mecanismo dos blocos de codigo
      // e celulas de tabela). Substitui a insercao manual de um no de texto "\n",
      // que nao renderizava a quebra final e exigia um segundo Shift+Enter. Na
      // serializacao o campo fonte volta a texto puro (o <br> vira "\n").
      event.preventDefault();
      document.execCommand("insertLineBreak", false);

      const nextSelection = window.getSelection();
      savedRangeRef.current =
        nextSelection && nextSelection.rangeCount > 0 ? nextSelection.getRangeAt(0).cloneRange() : null;

      emitChange();
      syncActiveActions();
      return true;
    }

    // action === "exit-block": Enter simples sai do diagrama.
    event.preventDefault();
    const { block, created } = getOrCreateEditableBlockAfter(diagram as HTMLElement);
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

  function toggleCurrentEquationCleanMode() {
    const equation = getCurrentEquation();
    if (!equation) {
      return;
    }

    const shouldEnable = !equation.classList.contains(notebookEquationCleanModeClassName);
    equation.classList.toggle(notebookEquationCleanModeClassName, shouldEnable);
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
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
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
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
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
    setIsTextMenuOpen(false);
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsCiteMenuOpen(false);
  }

  function openPdfPickerFromToolbar() {
    saveCurrentRangeOrEditorEnd();
    setIsTextMenuOpen(false);
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsLinkPopoverOpen(false);
    setIsCiteMenuOpen(false);
    setIsMoreMenuOpen(false);
    setShowAttachmentNotice(false);
    setAssetPasteError(null);
    onOpenPdfPicker?.();
  }

  function insertSeparatorBlock() {
    restoreSavedRangeOrEditorEnd();
    document.execCommand("insertHorizontalRule", false);
    emitChange();
    syncActiveActions();
    setIsTextMenuOpen(false);
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsMoreMenuOpen(false);
  }

  function applyParagraphStyle() {
    restoreSavedRangeOrEditorEnd();
    document.execCommand("formatBlock", false, "<div>");
    emitChange();
    syncActiveActions();
    setIsTextMenuOpen(false);
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsMoreMenuOpen(false);
  }

  function applyEditorActionFromMenu(action: EditorAction) {
    restoreSavedRangeOrEditorEnd();
    applyAction(action);
  }

  function applyMaintenanceCommand(command: "clear-formatting" | "unlink") {
    restoreSavedRange();

    if (command === "clear-formatting") {
      document.execCommand("removeFormat", false);
    } else {
      document.execCommand("unlink", false);
    }

    emitChange();
    syncActiveActions();
    setIsTextMenuOpen(false);
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsMoreMenuOpen(false);
  }

  function applyAlignmentCommand(command: AlignmentCommand) {
    restoreSavedRangeOrEditorEnd();
    document.execCommand(command, false);
    emitChange();
    syncActiveActions();
    setIsTextMenuOpen(false);
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsMoreMenuOpen(false);
  }

  function applySpacingMode(mode: NotebookSpacingMode) {
    onSpacingModeChange?.(mode);
    setIsTextMenuOpen(false);
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
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
    normalizeFigures(editor);
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
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsMoreMenuOpen(false);
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
    const notebookClipboardHtml = createSanitizedNotebookClipboardHtml(event.clipboardData.getData("text/html"));
    if (notebookClipboardHtml) {
      insertHtml(notebookClipboardHtml, { placeCursorInTrailingBlock: true });
      return;
    }

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

  // Fonte unica dos itens de insercao de bloco: alimenta a secao "Inserir"
  // do menu "..." e o menu inline "/" — nao duplicar entradas ao adicionar
  // um bloco novo.
  const insertMenuItems: NotebookInsertMenuItem[] = [
    // Titulos NAO entram aqui: apagar o trigger deixa o bloco vazio e o
    // formatBlock do Chromium nao consegue escopar nele, englobando o bloco
    // anterior. Titulos ficam no chip "Texto" da toolbar flutuante (com trecho
    // selecionado), onde o formatBlock tem fronteira correta — mesmo lugar do
    // protótipo, que tambem nao lista titulos no "/".
    { id: "table", section: "insert", label: "Tabela", keywords: ["tabela", "table"], icon: <TableIcon />, run: insertTableBlock },
    { id: "callout", section: "insert", label: "Callout", keywords: ["callout", "destaque", "chamada", "aviso"], icon: <CalloutIcon />, run: insertCalloutBlock },
    { id: "image", section: "insert", label: "Imagem", keywords: ["imagem", "image", "figura", "foto"], icon: <FigureIcon />, run: openLocalImagePicker },
    { id: "equation", section: "insert", label: "Equação", keywords: ["equacao", "formula", "latex", "matematica"], icon: <EquationIcon />, run: insertEquationBlock },
    {
      id: "separator",
      section: "insert",
      label: "Separador",
      keywords: ["separador", "divisor", "linha"],
      icon: <span className="h-[15px] w-[15px] border-t border-current" aria-hidden="true" />,
      run: insertSeparatorBlock,
    },
    ...diagramInsertSubtypes.flatMap((subtype): NotebookInsertMenuItem[] => {
      const diagramKind = diagramKindFromFigureSubtype(subtype);
      if (!diagramKind) {
        return [];
      }

      return [
        {
          id: subtype,
          section: "diagram",
          label: figureSubtypeLabels[subtype],
          keywords: ["diagrama", "diagram", "grafo", "fluxograma"],
          icon: <FigureIcon />,
          run: () => insertDiagramBlock(diagramKind),
        },
      ];
    }),
    { id: "attachment", section: "reference", label: "Anexar arquivo", keywords: ["anexo", "anexar", "arquivo", "attachment", "file"], icon: <AttachmentIcon />, run: openLocalAttachmentPicker },
    { id: "pdf", section: "reference", label: "Vincular PDF", keywords: ["pdf", "vincular", "documento"], icon: <PdfToolbarIcon />, run: openPdfPickerFromToolbar },
  ];

  const slashMenuQuery = slashMenu ? normalizeSlashFilterText(slashMenu.query) : "";
  const filteredSlashMenuItems =
    slashMenuQuery.length === 0
      ? insertMenuItems
      : insertMenuItems.filter((item) =>
          [item.label, ...item.keywords].some((term) => normalizeSlashFilterText(term).includes(slashMenuQuery)),
        );
  // Indice defensivamente clampado: o filtro pode encolher a lista entre o
  // ultimo ArrowDown e o proximo render.
  const slashSelectedIndex = slashMenu ? Math.min(slashMenu.selectedIndex, Math.max(0, filteredSlashMenuItems.length - 1)) : 0;

  // Mantem o item selecionado visivel quando as setas passam da area do menu.
  useEffect(() => {
    slashSelectedItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [slashSelectedIndex, slashMenu]);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Menu "/" aberto consome as teclas de navegacao ANTES dos handlers de
    // Enter/Delete de tabela/callout/diagrama/equacao — sem isso, Enter
    // escolheria um item E quebraria a linha da tabela ao mesmo tempo.
    if (slashMenu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const count = filteredSlashMenuItems.length;
        if (count > 0) {
          const direction = event.key === "ArrowDown" ? 1 : -1;
          const nextIndex = (slashSelectedIndex + direction + count) % count;
          setSlashMenu((current) => (current ? { ...current, selectedIndex: nextIndex } : current));
        }
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const item = filteredSlashMenuItems[slashSelectedIndex];
        if (item) {
          applySlashMenuItem(item);
        } else {
          closeSlashMenu();
        }
        return;
      }

      if (event.key === "Escape") {
        // preventDefault: o NotebookPanel fecha painel/drawer no Escape
        // quando defaultPrevented e false — este Esc e so do menu.
        event.preventDefault();
        closeSlashMenu();
        return;
      }

      if (event.key === "Tab") {
        // Tab abandona o menu e segue o fluxo normal (ex.: navegacao de
        // celula de tabela).
        closeSlashMenu();
      }

      if (event.key === "Backspace" || event.key === "Delete") {
        // Delecao de texto comum dentro da query: pula os handlers
        // estruturais abaixo; o input seguinte recalcula ou fecha o menu.
        return;
      }
    }

    if (event.key === "/" && !event.nativeEvent.isComposing && isValidSlashTriggerContext()) {
      // O caractere e inserido normalmente pelo browser; o menu abre no
      // input seguinte, depois de confirmar o "/" no DOM.
      pendingSlashTriggerRef.current = true;
    }

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

    // "Bloco de codigo" e um <code> inline (display:block via CSS), nao um
    // data-athenaeum-block estrutural — por isso fica fora dos handlers
    // acima. Sem interceptar o Enter aqui, o WebView2 pode fragmentar o
    // elemento em <code>s irmaos por linha (ver comentario em
    // richTextShared.ts); interceptamos os dois (Enter e Shift+Enter) para
    // ambos ficarem como <br> dentro do MESMO <code>, com a mesma saida por
    // linha vazia dos demais blocos multi-linha.
    if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey) {
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

    if (!event.shiftKey && isCaretOnEmptyTrailingLine(anchorCode)) {
      trimTrailingBlankLine(anchorCode);
      // O <code> e inline, filho do paragrafo <div> que o envolveu (nao um
      // bloco de topo como o callout): a saida cria a linha nova depois do
      // PARAGRAFO inteiro, nao depois do <code> em si — sen isso o novo
      // "bloco" nasceria aninhado dentro do proprio paragrafo.
      const paragraph = getTopLevelBlock(anchorCode, editor) ?? anchorCode;
      const { block, created } = getOrCreateEditableBlockAfter(paragraph);
      savedRangeRef.current = placeCursorAtEnd(block)?.cloneRange() ?? null;

      if (created) {
        emitChange();
      }

      syncActiveActions();
      return;
    }

    document.execCommand("insertLineBreak", false);
    emitChange();
    syncActiveActions();
  }

  const toolbarBaseTextClassName = "text-[var(--color-sidebar-muted)] hover:text-[var(--color-sidebar-text)]";
  const toolbarIconButtonClassName = `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition hover:bg-surface-muted ${toolbarBaseTextClassName}`;
  const toolbarChipButtonClassName = `notebook-toolbar-focus-menu-button inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-subtle bg-[var(--card)] px-2.5 text-xs font-semibold transition hover:bg-surface-muted ${toolbarBaseTextClassName}`;
  const activeToolbarButtonClassName = "bg-primary-soft text-[var(--color-sidebar-text)]";
  const focusToolbarSeparator = <span className="notebook-toolbar-focus-separator mx-1 h-6 w-px shrink-0 bg-border-subtle" aria-hidden="true" />;
  const menuPanelClassName = "absolute right-0 top-[calc(100%+6px)] z-40 max-h-[calc(100vh-7rem)] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border-subtle bg-surface-panel p-2 shadow-lg";
  const compactMenuPanelClassName = "absolute left-0 top-[calc(100%+6px)] z-40 max-h-[calc(100vh-7rem)] w-56 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border-subtle bg-surface-panel p-1 shadow-lg";
  const centeredCompactMenuPanelClassName = "absolute left-1/2 top-[calc(100%+6px)] z-40 max-h-[calc(100vh-7rem)] w-56 max-w-[calc(100vw-2rem)] -translate-x-1/2 overflow-y-auto rounded-lg border border-border-subtle bg-surface-panel p-1 shadow-lg";
  const menuSectionLabelClassName = "px-2 pb-1 pt-1 text-[11px] font-bold uppercase tracking-[0.12em] text-text-subtle";
  const menuItemClassName = "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary";
  const plainMenuItemClassName = "block w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary";
  const disabledMenuItemClassName = "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-secondary";
  const activeMenuItemClassName = "bg-primary-soft text-primary";
  const menuIconButtonClassName = "inline-flex h-8 w-full items-center justify-center rounded-md text-text-secondary transition hover:bg-surface-muted hover:text-text-primary";
  const boldButton = getToolbarButton("bold");
  const italicButton = getToolbarButton("italic");
  const unorderedListButton = getToolbarButton("unordered-list");
  const orderedListButton = getToolbarButton("ordered-list");
  const blockquoteButton = getToolbarButton("blockquote");
  const codeButton = getToolbarButton("code");
  const isParagraphActive = !activeActions.has("h1") && !activeActions.has("h2") && !activeActions.has("h3") && !activeActions.has("blockquote");

  const closePeerToolbarMenus = () => {
    setIsTextMenuOpen(false);
    setIsListMenuOpen(false);
    setIsReferenceMenuOpen(false);
    setIsLayoutMenuOpen(false);
    setIsLinkPopoverOpen(false);
    setIsCiteMenuOpen(false);
    setIsMoreMenuOpen(false);
    setShowAttachmentNotice(false);
  };

  function alignmentIcon(command: AlignmentCommand) {
    switch (command) {
      case "justifyCenter":
        return <AlignCenterIcon />;
      case "justifyRight":
        return <AlignRightIcon />;
      case "justifyFull":
        return <AlignJustifyIcon />;
      case "justifyLeft":
        return <AlignLeftIcon />;
    }
  }

  function renderToolbarActionButton(button: ReturnType<typeof getToolbarButton>, className = toolbarIconButtonClassName) {
    return (
      <button
        key={button.action}
        type="button"
        title={button.title}
        aria-label={button.title}
        aria-pressed={activeActions.has(button.action)}
        className={`${className} ${activeActions.has(button.action) ? activeToolbarButtonClassName : ""}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => applyAction(button.action)}
      >
        {button.icon}
      </button>
    );
  }

  const textMenu = isTextMenuOpen ? (
    <div className={compactMenuPanelClassName} role="menu" aria-label="Estilo do texto">
      <p className={menuSectionLabelClassName}>Texto</p>
      {textStyleOptions.map((option) => {
        const isActive = option.command === "paragraph" ? isParagraphActive : activeActions.has(option.command);

        return (
          <button
            key={option.command}
            type="button"
            role="menuitemradio"
            aria-checked={isActive}
            className={`${plainMenuItemClassName} ${isActive ? activeMenuItemClassName : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (option.command === "paragraph") {
                applyParagraphStyle();
                return;
              }

              applyEditorActionFromMenu(option.command);
            }}
          >
            {option.label}
          </button>
        );
      })}
      <div className="my-1 h-px bg-border-subtle" />
      <button
        type="button"
        role="menuitem"
        className={plainMenuItemClassName}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => applyMaintenanceCommand("clear-formatting")}
      >
        Limpar formatação
      </button>
    </div>
  ) : null;

  const listMenu = isListMenuOpen ? (
    <div className={centeredCompactMenuPanelClassName} role="menu" aria-label="Listas">
      <p className={menuSectionLabelClassName}>Listas</p>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={activeActions.has("unordered-list")}
        className={`${menuItemClassName} ${activeActions.has("unordered-list") ? activeMenuItemClassName : ""}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => applyEditorActionFromMenu("unordered-list")}
      >
        {unorderedListButton.icon}
        Lista com marcadores
      </button>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={activeActions.has("ordered-list")}
        className={`${menuItemClassName} ${activeActions.has("ordered-list") ? activeMenuItemClassName : ""}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => applyEditorActionFromMenu("ordered-list")}
      >
        {orderedListButton.icon}
        Lista numerada
      </button>
    </div>
  ) : null;

  const insertMenuContent = (
    <>
      <p className={menuSectionLabelClassName}>Inserir</p>
      {insertMenuItems
        .filter((item) => item.section === "insert")
        .map((item) => (
          <button key={item.id} type="button" className={menuItemClassName} onMouseDown={(event) => event.preventDefault()} onClick={item.run}>
            {item.icon}
            {item.label}
          </button>
        ))}
      <div className="my-1 h-px bg-border-subtle" />
      <p className={menuSectionLabelClassName}>Diagramas</p>
      {insertMenuItems
        .filter((item) => item.section === "diagram")
        .map((item) => (
          <button key={item.id} type="button" className={menuItemClassName} onMouseDown={(event) => event.preventDefault()} onClick={item.run}>
            {item.icon}
            {item.label}
          </button>
        ))}
    </>
  );

  const layoutMenuContent = (
    <>
      <p className={menuSectionLabelClassName}>Alinhamento</p>
      <div className="grid grid-cols-4 gap-1 px-1">
        {alignmentOptions.map((option) => {
          const isActive = activeAlignment === option.command;

          return (
            <button
              key={option.command}
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              title={option.label}
              aria-label={option.label}
              className={`${menuIconButtonClassName} ${isActive ? activeMenuItemClassName : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyAlignmentCommand(option.command)}
            >
              {alignmentIcon(option.command)}
            </button>
          );
        })}
      </div>
      <div className="my-1 h-px bg-border-subtle" />
      <p className={menuSectionLabelClassName}>Espaçamento</p>
      <div className="grid grid-cols-2 gap-1">
        {notebookSpacingOptions.map((option) => {
          const isActive = spacingMode === option.value;

          return (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={isActive}
              className={`rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition ${
                isActive ? activeMenuItemClassName : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applySpacingMode(option.value)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </>
  );

  const moreMenu = isMoreMenuOpen ? (
    <div className={menuPanelClassName}>
      {/* Formatação/Referências aparecem SEMPRE: sem a barra fixa, este menu é
          o único lugar com citação em bloco, código, citar, link, anexo e PDF
          fora do menu "/". */}
      <p className={menuSectionLabelClassName}>Formatação</p>
      <button type="button" className={menuItemClassName} onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorActionFromMenu("blockquote")}>
        {blockquoteButton.icon}
        Citação em bloco
      </button>
      <button type="button" className={menuItemClassName} onMouseDown={(event) => event.preventDefault()} onClick={() => applyEditorActionFromMenu("code")}>
        {codeButton.icon}
        Bloco de código
      </button>
      <div className="my-1 h-px bg-border-subtle" />
      <p className={menuSectionLabelClassName}>Referências</p>
      <button type="button" className={menuItemClassName} onMouseDown={(event) => event.preventDefault()} onClick={openCiteMenu}>
        <CitationIcon />
        Inserir citação
      </button>
      <button type="button" className={menuItemClassName} onMouseDown={(event) => event.preventDefault()} onClick={openLinkPopover}>
        <LinkIcon />
        Inserir link
      </button>
      <button type="button" className={menuItemClassName} onMouseDown={(event) => event.preventDefault()} onClick={openLocalAttachmentPicker}>
        <AttachmentIcon />
        Anexar arquivo
      </button>
      <button type="button" className={menuItemClassName} onMouseDown={(event) => event.preventDefault()} onClick={openPdfPickerFromToolbar}>
        <PdfToolbarIcon />
        Vincular PDF
      </button>
      <div className="my-1 h-px bg-border-subtle" />
      {insertMenuContent}
      <div className="my-1 h-px bg-border-subtle" />
      {layoutMenuContent}
      <div className="my-1 h-px bg-border-subtle" />
      <p className={menuSectionLabelClassName}>Manutenção</p>
      <button
        type="button"
        className={plainMenuItemClassName}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => applyMaintenanceCommand("clear-formatting")}
      >
        Limpar formatação
      </button>
      <button
        type="button"
        disabled={!isSelectionInLink}
        className={`${plainMenuItemClassName} ${disabledMenuItemClassName}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => applyMaintenanceCommand("unlink")}
      >
        Remover link
      </button>
    </div>
  ) : null;

  const textMenuButton = (
    <button
      type="button"
      title="Texto"
      aria-label="Texto"
      aria-haspopup="menu"
      aria-expanded={isTextMenuOpen}
      className={toolbarChipButtonClassName}
      onMouseDown={(event) => {
        event.preventDefault();
        saveCurrentRange();
      }}
      onClick={() => {
        const shouldOpen = !isTextMenuOpen;
        closePeerToolbarMenus();
        setIsTextMenuOpen(shouldOpen);
      }}
    >
      <span className="notebook-toolbar-focus-compact-icon text-sm font-bold leading-none" aria-hidden="true">T</span>
      <span className="notebook-toolbar-focus-label">Texto</span>
      <span className="notebook-toolbar-focus-chevron"><ChevronDownIcon /></span>
    </button>
  );

  const listMenuButton = (
    <button
      type="button"
      title="Listas"
      aria-label="Listas"
      aria-haspopup="menu"
      aria-expanded={isListMenuOpen}
      className={toolbarChipButtonClassName}
      onMouseDown={(event) => {
        event.preventDefault();
        saveCurrentRange();
      }}
      onClick={() => {
        const shouldOpen = !isListMenuOpen;
        closePeerToolbarMenus();
        setIsListMenuOpen(shouldOpen);
      }}
    >
      <span className="notebook-toolbar-focus-compact-icon" aria-hidden="true">{unorderedListButton.icon}</span>
      <span className="notebook-toolbar-focus-label">Listas</span>
      <span className="notebook-toolbar-focus-chevron"><ChevronDownIcon /></span>
    </button>
  );

  const moreMenuButton = (
    <div className="relative shrink-0">
      <button
        type="button"
        title="Mais opções"
        aria-label="Mais opções"
        aria-haspopup="menu"
        aria-expanded={isMoreMenuOpen}
        className={toolbarIconButtonClassName}
        onMouseDown={(event) => {
          event.preventDefault();
          saveCurrentRange();
        }}
        onClick={() => {
          const shouldOpen = !isMoreMenuOpen;
          closePeerToolbarMenus();
          setIsMoreMenuOpen(shouldOpen);
        }}
      >
        <MoreIcon />
      </button>
      {moreMenu}
    </div>
  );

  const focusToolbarControls = (
    <>
      {textMenuButton}
      {focusToolbarSeparator}
      {renderToolbarActionButton(boldButton)}
      {renderToolbarActionButton(italicButton)}
      {focusToolbarSeparator}
      {listMenuButton}
      <span className="min-w-2 flex-1" aria-hidden="true" />
      {moreMenuButton}
    </>
  );

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
      {/* Toolbar de formatacao FLUTUANTE: aparece ancorada acima do trecho
          selecionado (nao ha mais barra fixa). Usa o conjunto compacto de
          controles, cujo "..." mantem citacao/link/anexo/PDF/inserir/
          alinhamento/manutencao acessiveis. */}
      {selectionToolbarRect ? (
        <div
          ref={toolbarRef}
          data-toolbar-variant="floating"
          style={{ top: Math.max(8, selectionToolbarRect.top - 52), left: selectionToolbarRect.left }}
          className="fixed z-[60] flex h-11 min-w-0 -translate-x-1/2 flex-nowrap items-center gap-1 overflow-visible rounded-lg border border-border-subtle bg-[var(--card)] px-1.5 shadow-lg"
        >
          {focusToolbarControls}
          {textMenu}
          {listMenu}

          {isLinkPopoverOpen ? (
            <div className={"absolute left-1/2 top-[calc(100%+6px)] z-40 flex w-72 -translate-x-1/2 items-center gap-2 rounded-lg border border-border-subtle bg-surface-panel p-2 shadow-lg"}>
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
              "left-1/2 -translate-x-1/2"
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
              "left-1/2 -translate-x-1/2"
            }`}>
              Anexos gerais ficam para uma etapa futura.
            </div>
          ) : null}

          {assetPasteError ? (
            <div className={`absolute top-[calc(100%+6px)] z-40 w-72 rounded-lg border border-red-300 bg-surface-panel p-3 text-xs font-medium text-red-700 shadow-lg dark:border-red-900/60 dark:text-red-300 ${
              "left-1/2 -translate-x-1/2"
            }`}>
              {assetPasteError}
            </div>
          ) : null}

        </div>
      ) : null}

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
            <span className="h-4 w-px bg-border-subtle" aria-hidden="true" />
            <button
              type="button"
              title={activeTableCell.isCleanMode ? "Mostrar as bordas da tabela" : "Ocultar bordas e fundos das células"}
              aria-label={activeTableCell.isCleanMode ? "Mostrar as bordas da tabela" : "Ativar modo limpo da tabela"}
              aria-pressed={activeTableCell.isCleanMode}
              className={`rounded-md px-2 py-1 transition ${
                activeTableCell.isCleanMode ? "bg-primary-soft text-primary" : "hover:bg-surface-muted hover:text-text-primary"
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleCurrentTableCleanMode}
            >
              {activeTableCell.isCleanMode ? "Mostrar bordas" : "Modo limpo"}
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
              aria-pressed={isDiagramCleanMode}
              className={`rounded-md px-2 py-1 transition ${
                isDiagramCleanMode ? "bg-primary-soft text-primary" : "hover:bg-surface-muted hover:text-text-primary"
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setIsDiagramCleanMode((current) => !current)}
            >
              Modo limpo
            </button>
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
              title={activeEquation.isCleanMode ? "Mostrar fonte LaTeX" : "Ocultar fonte LaTeX e ativar o modo limpo"}
              aria-label={activeEquation.isCleanMode ? "Mostrar fonte LaTeX" : "Ativar modo limpo da equação"}
              aria-pressed={activeEquation.isCleanMode}
              className={`rounded-md px-2 py-1 transition ${
                activeEquation.isCleanMode ? "bg-primary-soft text-primary" : "hover:bg-surface-muted hover:text-text-primary"
              }`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleCurrentEquationCleanMode}
            >
              {activeEquation.isCleanMode ? "Mostrar fonte" : "Modo limpo"}
            </button>
            <span className="h-4 w-px bg-border-subtle" aria-hidden="true" />
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
        {slashMenu ? (
          <div
            ref={slashMenuRef}
            role="menu"
            aria-label="Inserir bloco"
            className="absolute z-40 flex flex-col gap-px overflow-y-auto rounded-lg border border-border-subtle bg-surface-panel p-1.5 shadow-lg"
            style={{ top: slashMenu.top, left: slashMenu.left, width: notebookSlashMenuWidth, maxHeight: notebookSlashMenuEstimatedHeight }}
          >
            <p className={menuSectionLabelClassName}>Inserir bloco</p>
            {filteredSlashMenuItems.length === 0 ? (
              <p className="px-3 py-2 text-xs font-medium text-text-subtle">Nenhum bloco encontrado</p>
            ) : (
              filteredSlashMenuItems.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  // O menu rola sozinho atras da selecao do teclado: as setas
                  // podem passar da area visivel. "nearest" so rola o
                  // necessario, e nunca a pagina atras do menu.
                  ref={index === slashSelectedIndex ? slashSelectedItemRef : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs font-semibold transition ${
                    index === slashSelectedIndex ? activeMenuItemClassName : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                  }`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applySlashMenuItem(item)}
                >
                  <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md bg-surface-muted text-text-primary" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))
            )}
          </div>
        ) : null}
        {isEmpty ? (
          <div className="pointer-events-none absolute inset-x-0 top-0">
            <span
              style={editorStyle}
              className={`block py-4 pr-5 font-serif text-sm leading-7 text-[var(--muted-foreground)] ${contentInsetClassName}`}
            >
              Escreva, ou tecle &quot;/&quot; para inserir um bloco...
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
          onInput={handleInput}
          onBlur={() => {
            closeSlashMenu();
            onBlur();
          }}
          onClick={handleEditorClick}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onScroll={() => {
            // Menu "/" e ancorado na posicao de abertura; rolagem fecha em
            // vez de reposicionar.
            closeSlashMenu();
            syncActiveActions();
          }}
          style={editorStyle}
          className={`notebook-editor notebook-editor--spaced ${isFocusMode ? "notebook-editor--focus" : ""} ${isCtrlPressed ? "notebook-editor--link-nav" : ""} ${isDiagramCleanMode ? "notebook-editor--diagram-clean-mode" : ""} h-full w-full overflow-y-auto break-words border-0 bg-transparent py-4 pr-5 text-sm leading-7 text-[var(--foreground)] outline-none ${contentInsetClassName}`}
        />
      </div>
    </div>
  );
}
