import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { ContextMenuDivider } from "../../components/ui/ContextMenuDivider";
import { ContextMenuItem } from "../../components/ui/ContextMenuItem";
import { ContextMenuSubmenu } from "../../components/ui/ContextMenuSubmenu";
import { ChevronRightIcon, TrashIcon } from "../../components/ui/SharedIcons";
import { SectionLabel } from "../../components/ui/SectionLabel";
import { CompactDocumentCard } from "../../components/CompactDocumentCard";
import { ProgressBar } from "../../components/ProgressBar";
import { TagBadge } from "../../components/TagBadge";
import { statusTokens } from "../../styles/designTokens";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { useFloatingPanels, type FloatingPanel } from "../../components/floating/FloatingPanelsContext";
import {
  createNotebookPage,
  deleteNotebookPage,
  getNotebookInfo,
  getSetting,
  isReaderInvalidationPayload,
  linkDocumentToNotebook,
  listNotebookLinkedDocuments,
  listNotebookPages,
  listNotebookTags,
  moveNotebookToTrash as movePersistedNotebookToTrash,
  READER_DETAILS_CHANGED_EVENT,
  saveNotebookPage,
  saveNotebookTags,
  selectNotebookExportDestination,
  setNotebookFavorite,
  setSetting,
  sumNotebookExportResourceBytes,
  unlinkDocumentFromNotebook,
  updateNotebookInfo,
  writeNotebookExport,
  type LinkedDocument,
  type NotebookExportWriteResult,
  type NotebookExportWriteWarning,
  type NotebookInfo,
  type NotebookReadingStatus,
} from "../../lib/database";
import { useContextMenu } from "../../hooks/useContextMenu";
import { deriveCoverHue } from "../../lib/documentColor";
import type { LibraryCollection, LibraryDocument, NotebookPage, SubjectTag } from "../../types/library";
import { DocumentPickerModal } from "../library/DocumentPickerModal";
import { TagSelector } from "../library/TagSelector";
import { getNotebookExportDefaultFileName } from "./notebookExportFileName";
import { buildNotebookExportHtml, type NotebookExportScope, type NotebookExportWarning } from "./notebookExportHtml";
import { estimateNotebookExportSizeBytes, shouldGateNotebookExportSize } from "./notebookExportSizeEstimate";
import { NotebookPrintModal } from "./NotebookPrintModal";
import { NotebookPageEditor, notebookSpacingOptions, type NotebookSpacingMode } from "./NotebookPageEditor";
import { PrintableNotebookView } from "./PrintableNotebookView";
import {
  beginNotebookPrintSession,
  buildNotebookPrintDocumentTitle,
  notebookPrintReadyTimeoutMs,
} from "./notebookPrintSession";
import {
  notebookDetailsColumnWidth,
  notebookPagesRailCollapsedWidth,
  notebookPagesRailExpandedWidth,
  notebookPanelHeight,
  notebookPanelMinHeight,
  notebookPanelMinWidth,
  notebookPanelWidth,
} from "./notebookPanelDimensions";

const contentInset = "mx-auto w-full max-w-[760px] px-6";
const focusContentInset = "mx-auto w-full max-w-[720px] px-6";
const notebookNormalSpacingSettingKey = "notebook_spacing_normal";
const notebookFocusSpacingSettingKey = "notebook_spacing_focus";
// Silencio de digitacao antes do autosave disparar. Ate existirem os saves de
// blur/troca de pagina/fechamento, nada gravava enquanto o usuario digitava
// sem sair do campo: o rotulo ficava em "Alterações não salvas" e um
// fechamento anormal perdia tudo desde o ultimo blur.
const notebookAutosaveDelayMs = 1200;
// Altura do header do frame (h-10) + bordas: o painel minimizado vira so a
// barra de titulo arrastavel.
const collapsedHeight = 42;

type EditorStats = {
  words: number;
  characters: number;
};

type NotebookSaveStatus = "saved" | "dirty" | "saving" | "error";

type NotebookExportPreparation = {
  notebookId: number;
  notebookTitle: string;
  scope: NotebookExportScope;
  pageIds: number[];
  destinationPath: string;
  createdAt: string;
  nonce: string;
  manifestSlotCount: number;
  warnings: NotebookExportWarning[];
  // Estimativa aproximada do tamanho do arquivo final, em bytes. null quando o
  // calculo falhou (ex.: erro na leitura dos file_size): nesse caso a interface
  // mostra "indisponivel" e o gate de confirmacao e ativado mesmo assim
  // (fail-safe) — a estimativa nunca aborta o export, mas "desconhecido" nao
  // libera silenciosamente.
  estimatedSizeBytes: number | null;
  // Verdadeiro quando o export exige confirmacao explicita de tamanho: acima do
  // limiar de 100MB OU estimativa desconhecida (null). Ver
  // shouldGateNotebookExportSize.
  isAboveSizeThreshold: boolean;
};

type NotebookPrintJob = {
  pages: NotebookPage[];
  documentTitle: string;
};

const editorZoomOptions = [75, 90, 100, 110, 125, 150] as const;

function getNotebookSaveStatusLabel(status: NotebookSaveStatus) {
  if (status === "dirty") {
    return "Alterações não salvas";
  }

  if (status === "saving") {
    return "Salvando...";
  }

  if (status === "error") {
    return "Erro ao salvar";
  }

  return "Salvo agora";
}

function getReadingStatusPercent(status: NotebookReadingStatus) {
  if (status === "completed") {
    return 100;
  }

  if (status === "in-progress") {
    return 65;
  }

  return 0;
}

function parseNotebookSpacingMode(value: string | null, fallback: NotebookSpacingMode) {
  return notebookSpacingOptions.some((option) => option.value === value) ? (value as NotebookSpacingMode) : fallback;
}

function getMaximizedPanelSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function getInitialPanelSize() {
  return {
    width: Math.min(notebookPanelWidth, window.innerWidth),
    height: Math.min(notebookPanelHeight, window.innerHeight),
  };
}

function getEditorStatsFromHtml(html: string): EditorStats {
  const container = window.document.createElement("div");
  container.innerHTML = html;
  const blockTags = new Set(["ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DIV", "FIGCAPTION", "FIGURE", "FOOTER", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION", "UL"]);

  function collectText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent ?? "";
    }

    if (!(node instanceof HTMLElement)) {
      return Array.from(node.childNodes).map(collectText).join("");
    }

    if (node.tagName === "BR") {
      return "\n";
    }

    const text = Array.from(node.childNodes).map(collectText).join("");
    return blockTags.has(node.tagName) ? `\n${text}\n` : text;
  }

  const text = collectText(container);
  const trimmedText = text.trim();

  return {
    words: trimmedText.length > 0 ? trimmedText.split(/\s+/).length : 0,
    characters: trimmedText.replace(/\s+/g, " ").length,
  };
}

function formatCount(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function pageDisplayTitle(page: NotebookPage) {
  // Fallback calculado na UI a partir de position — nunca persistido.
  return page.title ?? `Página sem título ${page.position}`;
}

function getNotebookExportErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Não foi possível preparar a exportação.";
}

function getNotebookExportWriteErrorMessage(error: unknown) {
  // Erros do comando Rust chegam como string via invoke.
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Não foi possível gravar o arquivo de exportação.";
}

function getNotebookPrintErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Não foi possível preparar o caderno para impressão.";
}

function formatExportFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${formatCount(bytes)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${formatCount(Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Estimativa de tamanho do arquivo de export, tolerante a falha: qualquer erro
// na leitura dos file_size devolve null (estimativa indisponivel) em vez de
// abortar a preparacao — a estimativa e uma conveniencia, nunca deve impedir o
// export. O HTML e medido em BYTES UTF-8 (TextEncoder), nao no length da string
// em JS, para nao subestimar conteudo com acentos e simbolos.
async function estimateExportSizeBytes(pageIds: number[], html: string): Promise<number | null> {
  try {
    const resourceBytes = await sumNotebookExportResourceBytes(pageIds);
    const htmlByteLength = new TextEncoder().encode(html).length;
    return estimateNotebookExportSizeBytes({ htmlByteLength, resourceBytes });
  } catch (error) {
    console.warn("Nao foi possivel estimar o tamanho da exportacao.", error);
    return null;
  }
}

function formatNotebookExportBuildWarning(warning: NotebookExportWarning) {
  return warning.message;
}

function formatNotebookExportWriteWarning(warning: NotebookExportWriteWarning) {
  const location = [warning.slotId, warning.pageId ? `página ${warning.pageId}` : null].filter(Boolean).join(" - ");

  return location ? `${warning.message} (${location})` : warning.message;
}

// Cor do dot de cada pagina: reusa o hue deterministico das capas de documento
// (deriveCoverHue) com a mesma saturacao/luminosidade dos dots de colecao — sem
// calculo de hue novo e sem cor nova. Seed = id da pagina (estavel e unico; o
// titulo pode ser vazio ou repetido entre paginas).
function pageDotColor(pageId: number) {
  return `hsl(${deriveCoverHue(String(pageId))} 55% 52%)`;
}

function BreadcrumbChevronIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="6" x2="18" y1="12" y2="12" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M8 20H4v-4" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4h12v12" />
      <path d="M4 8h12v12H4z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function PlusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <line x1="12" x2="12" y1="5" y2="19" />
      <line x1="5" x2="19" y1="12" y2="12" />
    </svg>
  );
}

function MinusIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <line x1="5" x2="19" y1="12" y2="12" />
    </svg>
  );
}

function AttachIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l8.5-8.5a4 4 0 0 1 5.7 5.7l-8.6 8.5a2 2 0 0 1-2.8-2.8l7.8-7.8" />
    </svg>
  );
}

function OpenBookIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 7v14" />
      <path d="M4 5a7 7 0 0 1 8 2 7 7 0 0 1 8-2v14a7 7 0 0 0-8 2 7 7 0 0 0-8-2z" />
    </svg>
  );
}

function MoreVerticalIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
    </svg>
  );
}

function MenuGlyph({
  name,
}: {
  name: "edit" | "folder" | "copy" | "pin" | "export" | "print" | "link" | "history" | "stats";
}) {
  const commonProps = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "edit") {
    return (
      <svg {...commonProps}>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      </svg>
    );
  }

  if (name === "folder") {
    return (
      <svg {...commonProps}>
        <path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      </svg>
    );
  }

  if (name === "copy") {
    return (
      <svg {...commonProps}>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
    );
  }

  if (name === "pin") {
    return (
      <svg {...commonProps}>
        <path d="m16 3 5 5" />
        <path d="M12 7 5 14l5 1 1 5 7-7" />
      </svg>
    );
  }

  if (name === "export") {
    return (
      <svg {...commonProps}>
        <path d="M12 3v12" />
        <path d="m7 8 5-5 5 5" />
        <path d="M5 21h14" />
      </svg>
    );
  }

  if (name === "print") {
    return (
      <svg {...commonProps}>
        <path d="M6 9V3h12v6" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <path d="M6 14h12v7H6z" />
      </svg>
    );
  }

  if (name === "link") {
    return (
      <svg {...commonProps}>
        <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1 1" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1-1" />
      </svg>
    );
  }

  if (name === "history") {
    return (
      <svg {...commonProps}>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 4v5h5" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M4 19V5" />
      <path d="M9 19v-8" />
      <path d="M14 19V9" />
      <path d="M19 19V4" />
    </svg>
  );
}

// Icone do botao que abre/fecha o drawer de Detalhes: glifo de informacao "i".
function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" x2="12" y1="11" y2="16" />
      <line x1="12" x2="12.01" y1="7.5" y2="7.5" />
    </svg>
  );
}

function FocusModeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3" />
      <path d="M12 19v3" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function formatNotebookDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const notebookReadingStatusOptions: Array<{ value: NotebookReadingStatus; label: string }> = [
  { value: "not-started", label: "Não iniciado" },
  { value: "in-progress", label: "Em progresso" },
  { value: "completed", label: "Concluído" },
];

const notebookSelectOptionClassName = "bg-surface-panel text-text-primary";
const notebookSelectOptionStyle = {
  backgroundColor: "var(--color-surface-panel)",
  color: "var(--color-text-primary)",
};
const notebookOptionsMenuWidth = 220;
const notebookOptionsMenuEstimatedHeight = 390;
const notebookOptionsMenuViewportMargin = 8;

function getNotebookOptionsMenuPosition(rect: DOMRect, placement: "header" | "footer") {
  const left = Math.max(
    notebookOptionsMenuViewportMargin,
    Math.min(rect.right - notebookOptionsMenuWidth, window.innerWidth - notebookOptionsMenuWidth - notebookOptionsMenuViewportMargin),
  );
  const preferredTop = placement === "footer" ? rect.top - notebookOptionsMenuEstimatedHeight - 6 : rect.bottom + 6;
  const top = Math.max(
    notebookOptionsMenuViewportMargin,
    Math.min(preferredTop, window.innerHeight - notebookOptionsMenuEstimatedHeight - notebookOptionsMenuViewportMargin),
  );

  return { left, top };
}

// Wrapper generico (rotulo + conteudo) para as secoes do drawer de Detalhes.
// O rotulo segue o estilo do protótipo: uppercase pequeno com tracking, igual
// aos rotulos de secao do painel de Detalhes do Reader.
function NotebookInfoField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-6 first:mt-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-subtle">{label}</p>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

type NotebookPanelProps = {
  panel: FloatingPanel;
  collections: LibraryCollection[];
  // Biblioteca inteira (para o seletor de "Attach another PDF") e o vocabulario
  // de tags — ambos ja carregados pelo LibraryView, passados por prop para nao
  // refazer a query aqui dentro.
  documents: LibraryDocument[];
  availableTags: SubjectTag[];
  onAvailableTagsChange: (tags: SubjectTag[]) => void;
  onClose: () => void;
  initialMaximized?: boolean;
  // Avisa a listagem (contagem de paginas / "Editado ha X") apos cada save.
  onNotebookChanged: () => void;
  onNotebookMovedToTrash?: () => void;
};

export function NotebookPanel({
  panel,
  collections,
  documents,
  availableTags,
  onAvailableTagsChange,
  onClose,
  initialMaximized = false,
  onNotebookChanged,
  onNotebookMovedToTrash,
}: NotebookPanelProps) {
  const notebookId = Number(panel.entityId);
  const { panels, movePanel } = useFloatingPanels();

  const [notebookTitle, setNotebookTitle] = useState("");
  const [pages, setPages] = useState<NotebookPage[]>([]);
  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [contextPageId, setContextPageId] = useState<number | null>(null);
  const initialPanelSizeRef = useRef(getInitialPanelSize());
  const [panelSize, setPanelSize] = useState(() => (initialMaximized ? getMaximizedPanelSize() : initialPanelSizeRef.current));
  const [isMaximized, setIsMaximized] = useState(initialMaximized);
  const pageContextMenu = useContextMenu();
  const [draftTitle, setDraftTitle] = useState("");
  const [editorStats, setEditorStats] = useState<EditorStats>({ words: 0, characters: 0 });
  const [editorZoomPercent, setEditorZoomPercent] = useState(100);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<NotebookSaveStatus>("saved");
  const [isStatsDialogOpen, setIsStatsDialogOpen] = useState(false);
  const [isPrintDialogOpen, setIsPrintDialogOpen] = useState(false);
  const [isPreparingPrint, setIsPreparingPrint] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printJob, setPrintJob] = useState<NotebookPrintJob | null>(null);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportScope, setExportScope] = useState<NotebookExportScope>("full-notebook");
  const [isPreparingExport, setIsPreparingExport] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [preparedExport, setPreparedExport] = useState<NotebookExportPreparation | null>(null);
  // Confirmacao explicita do usuario para exportar acima do limiar de tamanho.
  // Resetada a cada nova preparacao e troca de escopo: uma preparacao grande
  // sempre exige marcar o aviso de novo antes de habilitar "Exportar".
  const [hasConfirmedLargeExport, setHasConfirmedLargeExport] = useState(false);
  const [isWritingExport, setIsWritingExport] = useState(false);
  const [exportResult, setExportResult] = useState<NotebookExportWriteResult | null>(null);
  const [normalSpacingMode, setNormalSpacingMode] = useState<NotebookSpacingMode>("normal");
  const [focusSpacingMode, setFocusSpacingMode] = useState<NotebookSpacingMode>("comfortable");
  const [openedAt] = useState(() => new Date().toISOString());
  const restoreStateRef = useRef<{
    position: { x: number; y: number };
    size: { width: number; height: number };
    collapsed: boolean;
  } | null>(initialMaximized ? { position: panel.position, size: initialPanelSizeRef.current, collapsed: false } : null);
  const hasAppliedInitialMaximizedRef = useRef(initialMaximized);

  // Trilho de Paginas (esquerda): sempre presente fora do modo foco. O UNICO
  // mecanismo de recolher e o toggle do proprio trilho (icone de pilha), que
  // alterna a largura entre colapsado (so os dots) e expandido (com titulos).
  // Nasce SEMPRE colapsado e nunca persiste — reabrir o caderno recomeca
  // colapsado. A expansao faz reflow real do editor (diferente do drawer de
  // Detalhes, que sobrepoe).
  const [isPagesRailExpanded, setIsPagesRailExpanded] = useState(false);
  const pagesRailRef = useRef<HTMLElement | null>(null);

  // Drawer de Detalhes: fechado por padrao, sempre um overlay flutuante sobre
  // o editor (nunca reflow) — so abre sob demanda pelo icone "i" do header.
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(false);

  // Dados do caderno (titulo/colecao/descricao). O ESTADO ja existe desde a
  // Parte 2, mas os CAMPOS de edicao (Colecao, Tags, PDFs vinculados,
  // Descricao) so entram na Parte 3 — aqui a coluna de Detalhes e so um
  // placeholder.
  const [notebookInfo, setNotebookInfo] = useState<NotebookInfo | null>(null);
  const [infoDraftTitle, setInfoDraftTitle] = useState("");
  const [infoDraftDescription, setInfoDraftDescription] = useState("");
  const [infoDraftCollectionId, setInfoDraftCollectionId] = useState("");
  const [infoDraftReadingStatus, setInfoDraftReadingStatus] = useState<NotebookReadingStatus>("not-started");
  const [infoDraftAuthorDiscipline, setInfoDraftAuthorDiscipline] = useState("");
  const infoDraftTitleRef = useRef("");
  const infoDraftDescriptionRef = useRef("");
  const infoDraftCollectionIdRef = useRef("");
  const infoDraftReadingStatusRef = useRef<NotebookReadingStatus>("not-started");
  const infoDraftAuthorDisciplineRef = useRef("");
  const isInfoDirtyRef = useRef(false);

  // Tags do caderno + PDFs vinculados na coluna de Detalhes.
  const [notebookTags, setNotebookTags] = useState<SubjectTag[]>([]);
  const [linkedDocuments, setLinkedDocuments] = useState<LinkedDocument[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);
  // Dropdown para trocar o status de leitura (a pílula do topo do drawer abre).
  const [isReadingStatusDropdownOpen, setIsReadingStatusDropdownOpen] = useState(false);
  const readingStatusDropdownRef = useRef<HTMLDivElement | null>(null);
  const notebookOptionsContextMenu = useContextMenu();
  const detailsColumnRef = useRef<HTMLElement | null>(null);
  const detailsToggleButtonRef = useRef<HTMLButtonElement | null>(null);
  const detailsCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const wasDetailsPanelOpenRef = useRef(false);
  // "Renomear caderno" abre o drawer (onde vive o campo de título) e pede foco
  // no título; esta flag faz o efeito de foco de abertura mirar o título em vez
  // do botão de fechar, sem corrida entre os dois.
  const pendingTitleFocusRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const notebookTagDropdownRef = useRef<HTMLDivElement | null>(null);

  // Rascunho corrente fora do estado React: o conteudo muda a cada tecla e
  // re-renderizar o painel inteiro por tecla seria desperdicio — o autosave
  // le os refs no momento do save.
  const activePageIdRef = useRef<number | null>(null);
  const draftTitleRef = useRef("");
  const draftContentRef = useRef("");
  const isDirtyRef = useRef(false);
  const saveQueueTailRef = useRef<Promise<void>>(Promise.resolve());
  const autosaveTimerRef = useRef<number | null>(null);
  const printHasStartedRef = useRef(false);
  const printSessionCompletedRef = useRef(false);
  const printSessionRestoreRef = useRef<(() => void) | null>(null);
  const onNotebookChangedRef = useRef(onNotebookChanged);
  onNotebookChangedRef.current = onNotebookChanged;

  function setActivePageDrafts(page: NotebookPage) {
    setActivePageId(page.id);
    activePageIdRef.current = page.id;
    setDraftTitle(page.title ?? "");
    draftTitleRef.current = page.title ?? "";
    draftContentRef.current = page.content;
    setEditorStats(getEditorStatsFromHtml(page.content));
    isDirtyRef.current = false;
    setSaveStatus("saved");
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [info, loadedPages, loadedTags, loadedLinkedDocs] = await Promise.all([
          getNotebookInfo(notebookId),
          listNotebookPages(notebookId),
          listNotebookTags(notebookId),
          listNotebookLinkedDocuments(notebookId),
        ]);
        // Caderno sem paginas (so possivel se o INSERT da primeira pagina
        // falhou na criacao): cria uma na hora para o editor ter onde focar.
        const ensuredPages = loadedPages.length > 0 ? loadedPages : [await createNotebookPage(notebookId)];

        if (cancelled) {
          return;
        }

        setNotebookInfo(info);
        setNotebookTitle(info.title);
        setInfoDraftTitle(info.title);
        setInfoDraftDescription(info.description);
        setInfoDraftCollectionId(info.collectionId);
        setInfoDraftReadingStatus(info.readingStatus);
        setInfoDraftAuthorDiscipline(info.authorDiscipline);
        infoDraftTitleRef.current = info.title;
        infoDraftDescriptionRef.current = info.description;
        infoDraftCollectionIdRef.current = info.collectionId;
        infoDraftReadingStatusRef.current = info.readingStatus;
        infoDraftAuthorDisciplineRef.current = info.authorDiscipline;
        isInfoDirtyRef.current = false;
        setNotebookTags(loadedTags);
        setLinkedDocuments(loadedLinkedDocs);
        setPages(ensuredPages);
        setActivePageDrafts(ensuredPages[0]);
      } catch (error) {
        console.warn("Nao foi possivel carregar o caderno.", error);
        if (!cancelled) {
          setLoadError(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intencional: o painel carrega o caderno uma vez; trocar de caderno
    // significa outro painel (outra key na lista do LibraryView).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  // Um vínculo criado ou removido no Reader também precisa aparecer em um
  // Caderno que já esteja aberto na pilha de painéis.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listen<unknown>(READER_DETAILS_CHANGED_EVENT, (event) => {
      if (!isReaderInvalidationPayload(event.payload)) {
        return;
      }

      void listNotebookLinkedDocuments(notebookId)
        .then((loadedDocuments) => {
          if (!disposed) {
            setLinkedDocuments(loadedDocuments);
          }
        })
        .catch((error) => {
          console.warn("Nao foi possivel sincronizar os PDFs vinculados ao Caderno.", error);
        });
    })
      .then((removeListener) => {
        if (disposed) {
          removeListener();
          return;
        }

        unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Nao foi possivel escutar alteracoes de vinculo do Reader.", error);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [notebookId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [normalSpacing, focusSpacing] = await Promise.all([
          getSetting(notebookNormalSpacingSettingKey),
          getSetting(notebookFocusSpacingSettingKey),
        ]);

        if (cancelled) {
          return;
        }

        setNormalSpacingMode(parseNotebookSpacingMode(normalSpacing, "normal"));
        setFocusSpacingMode(parseNotebookSpacingMode(focusSpacing, "comfortable"));
      } catch (error) {
        console.warn("Nao foi possivel carregar as preferencias de espacamento do caderno.", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const saveActivePage = useCallback(() => {
    const runQueuedSave = async () => {
      const pageId = activePageIdRef.current;

      if (!isDirtyRef.current || pageId === null) {
        return;
      }

      const trimmedTitle = draftTitleRef.current.trim();
      const title = trimmedTitle.length > 0 ? trimmedTitle : null;
      const content = draftContentRef.current;

      isDirtyRef.current = false;
      setSaveStatus("saving");

      try {
        await saveNotebookPage(pageId, { title, content });
        setPages((currentPages) => currentPages.map((page) => (page.id === pageId ? { ...page, title, content } : page)));
        setNotebookInfo((currentInfo) => (currentInfo ? { ...currentInfo, updatedAt: new Date().toISOString() } : currentInfo));
        setSaveStatus(isDirtyRef.current ? "dirty" : "saved");
        onNotebookChangedRef.current();
      } catch (error) {
        console.warn("Nao foi possivel salvar a pagina do caderno.", error);
        isDirtyRef.current = true;
        setSaveStatus("error");
        throw error;
      }
    };

    const publicPromise = saveQueueTailRef.current.then(runQueuedSave);
    saveQueueTailRef.current = publicPromise.catch(() => undefined);
    return publicPromise;
  }, []);

  const saveNotebookInfoDraft = useCallback(async () => {
    if (!isInfoDirtyRef.current) {
      return;
    }

    const nextTitle = infoDraftTitleRef.current.trim() || "Caderno sem título";
    const nextDescription = infoDraftDescriptionRef.current;
    const nextCollectionId = infoDraftCollectionIdRef.current || notebookInfo?.collectionId || collections[0]?.id || "";
    const nextReadingStatus = infoDraftReadingStatusRef.current;
    const nextAuthorDiscipline = infoDraftAuthorDisciplineRef.current;

    if (!nextCollectionId) {
      return;
    }

    isInfoDirtyRef.current = false;
    setSaveStatus("saving");

    try {
      const updatedInfo = await updateNotebookInfo(notebookId, {
        title: nextTitle,
        description: nextDescription,
        collectionId: nextCollectionId,
        readingStatus: nextReadingStatus,
        authorDiscipline: nextAuthorDiscipline,
      });
      setNotebookInfo(updatedInfo);
      setNotebookTitle(updatedInfo.title);
      setInfoDraftTitle(updatedInfo.title);
      setInfoDraftDescription(updatedInfo.description);
      setInfoDraftCollectionId(updatedInfo.collectionId);
      setInfoDraftReadingStatus(updatedInfo.readingStatus);
      setInfoDraftAuthorDiscipline(updatedInfo.authorDiscipline);
      infoDraftTitleRef.current = updatedInfo.title;
      infoDraftDescriptionRef.current = updatedInfo.description;
      infoDraftCollectionIdRef.current = updatedInfo.collectionId;
      infoDraftReadingStatusRef.current = updatedInfo.readingStatus;
      infoDraftAuthorDisciplineRef.current = updatedInfo.authorDiscipline;
      setSaveStatus("saved");
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel salvar as informacoes do caderno.", error);
      isInfoDirtyRef.current = true;
      setSaveStatus("error");
    }
  }, [collections, notebookId, notebookInfo?.collectionId]);

  // Salva sozinho depois de uma pausa na digitacao. Cada chamada reinicia a
  // contagem, entao digitar sem parar nao grava a cada tecla — grava quando o
  // usuario respira. Os dois saves sao guardados pelos refs de "sujo", entao
  // chamar ambos aqui e barato e idempotente.
  const flushSaves = useCallback(() => {
    void saveActivePage();
    void saveNotebookInfoDraft();
  }, [saveActivePage, saveNotebookInfoDraft]);

  const scheduleAutosave = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
    }

    autosaveTimerRef.current = window.setTimeout(() => {
      autosaveTimerRef.current = null;
      flushSaves();
    }, notebookAutosaveDelayMs);
  }, [flushSaves]);

  // Ctrl+S / Cmd+S: grava na hora e cancela o autosave agendado. So responde
  // quando este painel e o topo da pilha, como o Esc.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "s" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }

      const topPanel = panels[panels.length - 1];
      if (topPanel?.id !== panel.id) {
        return;
      }

      // preventDefault: sem isso o WebView2 abre o "salvar pagina" do Chromium.
      event.preventDefault();

      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }

      flushSaves();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panels, panel.id, flushSaves]);

  // Um autosave agendado nao pode disparar depois do painel sair de cena: o
  // cleanup de unmount ja grava o que estiver sujo.
  useEffect(() => {
    return () => {
      if (autosaveTimerRef.current !== null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, []);

  const handleTagsChange = useCallback(
    async (nextTags: SubjectTag[]) => {
      setNotebookTags(nextTags); // otimista: a UI reflete na hora
      setSaveStatus("saving");
      try {
        await saveNotebookTags(notebookId, nextTags);
        setSaveStatus("saved");
      } catch (error) {
        console.warn("Nao foi possivel salvar as tags do caderno.", error);
        setSaveStatus("error");
      }
    },
    [notebookId],
  );

  const handleAttachDocument = useCallback(
    async (documentId: string) => {
      // O modal continua aberto apos vincular; atualizamos a lista local na
      // hora para o item virar "Já vinculado" imediatamente (o Set derivado
      // abaixo passa a conter o id).
      if (linkedDocuments.some((document) => document.id === documentId)) {
        return;
      }

      const source = documents.find((document) => document.id === documentId);
      if (source) {
        setLinkedDocuments((current) => [
          ...current,
          { id: source.id, title: source.title, authors: source.authors, year: source.year, collection: source.collection },
        ]);
      }

      setSaveStatus("saving");
      try {
        await linkDocumentToNotebook(notebookId, documentId);
        setSaveStatus("saved");
      } catch (error) {
        console.warn("Nao foi possivel vincular o documento.", error);
        setLinkedDocuments((current) => current.filter((document) => document.id !== documentId));
        setSaveStatus("error");
      }
    },
    [documents, linkedDocuments, notebookId],
  );

  const handleUnlinkDocument = useCallback(
    async (documentId: string) => {
      setLinkedDocuments((current) => current.filter((document) => document.id !== documentId));
      setSaveStatus("saving");

      try {
        await unlinkDocumentFromNotebook(notebookId, documentId);
        setSaveStatus("saved");
      } catch (error) {
        console.warn("Nao foi possivel desvincular o documento.", error);
        setSaveStatus("error");
        // Recarrega do banco para reconciliar (mais seguro que remontar o item
        // otimisticamente removido a partir de um estado ja defasado).
        try {
          setLinkedDocuments(await listNotebookLinkedDocuments(notebookId));
        } catch {
          // silencioso: se ate o reload falhar, a proxima abertura corrige.
        }
      }
    },
    [notebookId],
  );

  function focusNotebookTitle() {
    notebookOptionsContextMenu.close();

    // O campo de título vive no drawer de Detalhes. Se ele estiver fechado,
    // abre e deixa o efeito de foco de abertura mirar o título (via flag). Se
    // já estiver aberto, não há transição — foca direto.
    if (isDetailsPanelOpen) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    } else {
      pendingTitleFocusRef.current = true;
      setIsDetailsPanelOpen(true);
    }
  }

  async function moveNotebookFromOptions(collectionId: string) {
    if (collectionId === infoDraftCollectionIdRef.current) {
      notebookOptionsContextMenu.close();
      return;
    }

    setInfoDraftCollectionId(collectionId);
    infoDraftCollectionIdRef.current = collectionId;
    isInfoDirtyRef.current = true;
    setSaveStatus("dirty");
    notebookOptionsContextMenu.close();
    await saveNotebookInfoDraft();
  }

  async function pinNotebookFavorite() {
    notebookOptionsContextMenu.close();

    if (notebookInfo?.favorite) {
      return;
    }

    setSaveStatus("saving");
    try {
      await setNotebookFavorite(notebookId, true);
      setNotebookInfo((currentInfo) => (currentInfo ? { ...currentInfo, favorite: true } : currentInfo));
      setSaveStatus("saved");
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel fixar o caderno nos favoritos.", error);
      setSaveStatus("error");
    }
  }

  function openDetailedCount() {
    notebookOptionsContextMenu.close();
    setIsStatsDialogOpen(true);
  }

  function openNotebookExportDialog() {
    notebookOptionsContextMenu.close();
    setExportScope("full-notebook");
    setExportError(null);
    setPreparedExport(null);
    setHasConfirmedLargeExport(false);
    setExportResult(null);
    setIsExportDialogOpen(true);
  }

  function closeNotebookExportDialog() {
    if (isPreparingExport || isWritingExport) {
      return;
    }

    setIsExportDialogOpen(false);
    setExportError(null);
  }

  function openNotebookPrintDialog() {
    notebookOptionsContextMenu.close();
    printHasStartedRef.current = false;
    printSessionCompletedRef.current = false;
    setPrintJob(null);
    setPrintError(null);
    setIsPreparingPrint(false);
    setIsPrintDialogOpen(true);
  }

  function closeNotebookPrintDialog() {
    if (isPreparingPrint || printJob) {
      return;
    }

    setIsPrintDialogOpen(false);
    setPrintError(null);
  }

  const finishNotebookPrint = useCallback(() => {
    printSessionCompletedRef.current = true;
    printSessionRestoreRef.current = null;
    printHasStartedRef.current = false;
    setPrintJob(null);
    setPrintError(null);
    setIsPreparingPrint(false);
    setIsPrintDialogOpen(false);
  }, []);

  const triggerNotebookPrint = useCallback(() => {
    if (!printJob || printHasStartedRef.current) {
      return;
    }

    printHasStartedRef.current = true;
    printSessionCompletedRef.current = false;

    try {
      const session = beginNotebookPrintSession({
        title: printJob.documentTitle,
        onAfterPrint: finishNotebookPrint,
      });
      if (!printSessionCompletedRef.current) {
        printSessionRestoreRef.current = session.restore;
      }
    } catch (error) {
      console.warn("Nao foi possivel abrir o dialogo nativo de impressao.", error);
      printHasStartedRef.current = false;
      setPrintJob(null);
      setIsPreparingPrint(false);
      setPrintError(getNotebookPrintErrorMessage(error));
    }
  }, [finishNotebookPrint, printJob]);

  async function prepareNotebookPrint(pageIds: number[]) {
    if (pageIds.length === 0 || isPreparingPrint) {
      return;
    }

    setPrintError(null);
    setIsPreparingPrint(true);

    try {
      await saveNotebookInfoDraft();
      if (isInfoDirtyRef.current) {
        throw new Error("Não foi possível salvar as informações mais recentes do caderno.");
      }

      // Usa a mesma fila serializada do autosave antes de reler as páginas.
      await saveActivePage();

      const persistedPages = await listNotebookPages(notebookId);
      const selectedPageIds = new Set(pageIds);
      const selectedPages = persistedPages.filter((page) => selectedPageIds.has(page.id));
      if (selectedPages.length !== selectedPageIds.size) {
        throw new Error("Não foi possível carregar todas as páginas selecionadas para impressão.");
      }

      const currentNotebookTitle =
        infoDraftTitleRef.current.trim() || notebookTitle || notebookInfo?.title || "Caderno sem título";
      printHasStartedRef.current = false;
      printSessionCompletedRef.current = false;
      setPrintJob({
        pages: selectedPages,
        documentTitle: buildNotebookPrintDocumentTitle(currentNotebookTitle, selectedPages),
      });
    } catch (error) {
      console.warn("Nao foi possivel preparar a impressao do caderno.", error);
      setIsPreparingPrint(false);
      setPrintError(getNotebookPrintErrorMessage(error));
    }
  }

  useEffect(() => {
    if (!printJob) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      console.warn("A impressao do caderno atingiu o limite de espera; abrindo o dialogo com o conteudo disponivel.");
      triggerNotebookPrint();
    }, notebookPrintReadyTimeoutMs);

    return () => window.clearTimeout(timeoutId);
  }, [printJob, triggerNotebookPrint]);

  useEffect(() => {
    return () => {
      printSessionRestoreRef.current?.();
      printSessionRestoreRef.current = null;
    };
  }, []);

  async function prepareNotebookExport() {
    setExportError(null);
    setPreparedExport(null);
    setHasConfirmedLargeExport(false);
    setExportResult(null);
    setIsPreparingExport(true);

    try {
      await saveNotebookInfoDraft();
      if (isInfoDirtyRef.current) {
        throw new Error("Não foi possível salvar as informações mais recentes do caderno.");
      }

      await saveActivePage();

      const persistedPages = await listNotebookPages(notebookId);
      const pageIds =
        exportScope === "current-page" ? (activePageIdRef.current === null ? [] : [activePageIdRef.current]) : persistedPages.map((page) => page.id);
      if (pageIds.length === 0) {
        throw new Error("Não há páginas para exportar.");
      }

      const persistedPagesById = new Map(persistedPages.map((page) => [page.id, page]));
      const selectedPages = pageIds.map((pageId) => persistedPagesById.get(pageId)).filter((page): page is NotebookPage => Boolean(page));
      if (selectedPages.length !== pageIds.length) {
        throw new Error("Não foi possível carregar todas as páginas persistidas para exportação.");
      }

      const defaultFileName = getNotebookExportDefaultFileName(infoDraftTitleRef.current || notebookTitle || notebookInfo?.title || "Caderno");
      const destinationPath = await selectNotebookExportDestination({ defaultFileName });
      if (!destinationPath) {
        return;
      }

      const exportTitle = infoDraftTitleRef.current.trim() || notebookTitle || notebookInfo?.title || "Caderno";
      const build = await buildNotebookExportHtml({
        notebookId,
        notebookTitle: exportTitle,
        scope: exportScope,
        pages: selectedPages,
      });

      // Estimativa de tamanho: bytes UTF-8 do HTML montado (fontes/CSS/SVG ja
      // embutidos) + os binarios de assets/anexos inflados por base64. A falha
      // do calculo NUNCA aborta o export — degrada para "indisponivel".
      const estimatedSizeBytes = await estimateExportSizeBytes(pageIds, build.html);
      // Fail-safe: estimativa desconhecida (null) ATIVA o gate, igual a uma
      // estimativa acima do limiar. Ver shouldGateNotebookExportSize.
      const isAboveSizeThreshold = shouldGateNotebookExportSize(estimatedSizeBytes);

      setPreparedExport({
        notebookId,
        notebookTitle: exportTitle,
        scope: exportScope,
        pageIds,
        destinationPath,
        createdAt: build.manifest.createdAt,
        nonce: build.manifest.nonce,
        manifestSlotCount: build.manifest.slots.length,
        warnings: build.warnings,
        estimatedSizeBytes,
        isAboveSizeThreshold,
      });
    } catch (error) {
      console.warn("Nao foi possivel preparar a exportacao do caderno.", error);
      setExportError(getNotebookExportErrorMessage(error));
    } finally {
      setIsPreparingExport(false);
    }
  }

  async function runNotebookExport() {
    if (!preparedExport) {
      return;
    }

    setExportError(null);
    setIsWritingExport(true);

    try {
      // Garante que a pagina ativa esta persistida ANTES de reler e reconstruir:
      // se o usuario editou entre "Preparar" e "Exportar", o arquivo gravado
      // ainda reflete o estado mais recente. Usa a mesma fila serializada de
      // autosave (saveQueueTailRef), entao nao concorre com um save pendente.
      await saveActivePage();

      const persistedPages = await listNotebookPages(preparedExport.notebookId);
      const persistedPagesById = new Map(persistedPages.map((page) => [page.id, page]));
      const selectedPages = preparedExport.pageIds.map((pageId) => persistedPagesById.get(pageId)).filter((page): page is NotebookPage => Boolean(page));
      if (selectedPages.length !== preparedExport.pageIds.length) {
        throw new Error("Nao foi possivel carregar todas as paginas persistidas para exportacao.");
      }

      const build = await buildNotebookExportHtml({
        notebookId: preparedExport.notebookId,
        notebookTitle: preparedExport.notebookTitle,
        scope: preparedExport.scope,
        pages: selectedPages,
        createdAt: new Date(preparedExport.createdAt),
        nonce: preparedExport.nonce,
      });
      const result = await writeNotebookExport({
        destinationPath: preparedExport.destinationPath,
        html: build.html,
        manifest: build.manifest,
      });

      setExportResult(result);
    } catch (error) {
      console.warn("Nao foi possivel gravar a exportacao do caderno.", error);
      setExportError(getNotebookExportWriteErrorMessage(error));
    } finally {
      setIsWritingExport(false);
    }
  }

  function openNotebookOptionsMenu(event: ReactMouseEvent<HTMLElement>, placement: "header" | "footer") {
    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const position = getNotebookOptionsMenuPosition(rect, placement);
    notebookOptionsContextMenu.openAt(position.left, position.top);
  }

  async function moveNotebookToTrashFromOptions() {
    notebookOptionsContextMenu.close();
    await saveNotebookInfoDraft();
    await saveActivePage();

    setSaveStatus("saving");
    try {
      await movePersistedNotebookToTrash(notebookId);
      setSaveStatus("saved");
      onNotebookMovedToTrash?.();
      onNotebookChangedRef.current();
      onClose();
    } catch (error) {
      console.warn("Nao foi possivel mover o caderno para a lixeira.", error);
      setSaveStatus("error");
    }
  }

  async function switchToPage(pageId: number) {
    if (pageId === activePageIdRef.current) {
      return;
    }

    const nextPage = pages.find((page) => page.id === pageId);
    if (!nextPage) {
      return;
    }

    await saveActivePage();
    setActivePageDrafts(nextPage);
  }

  async function addPage() {
    await saveActivePage();

    try {
      setSaveStatus("saving");
      const page = await createNotebookPage(notebookId);
      setPages((currentPages) => [...currentPages, page]);
      setNotebookInfo((currentInfo) => (currentInfo ? { ...currentInfo, updatedAt: page.createdAt } : currentInfo));
      setActivePageDrafts(page);
      setSaveStatus("saved");
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel criar a pagina.", error);
      setSaveStatus("error");
    }
  }

  async function deleteContextPage() {
    const pageId = contextPageId;
    const page = pages.find((currentPage) => currentPage.id === pageId);

    pageContextMenu.close();

    if (!page) {
      return;
    }

    if (page.id !== activePageIdRef.current) {
      await saveActivePage();
    }

    try {
      setSaveStatus("saving");
      await deleteNotebookPage(notebookId, page.id);

      let nextPages = await listNotebookPages(notebookId);
      if (nextPages.length === 0) {
        nextPages = [await createNotebookPage(notebookId)];
      }

      setPages(nextPages);

      const activePageStillExists = nextPages.some((nextPage) => nextPage.id === activePageIdRef.current);
      if (page.id === activePageIdRef.current || !activePageStillExists) {
        const nextActivePage = nextPages.find((nextPage) => nextPage.position >= page.position) ?? nextPages[nextPages.length - 1];
        setActivePageDrafts(nextActivePage);
      }

      setNotebookInfo((currentInfo) => (currentInfo ? { ...currentInfo, updatedAt: new Date().toISOString() } : currentInfo));
      setSaveStatus("saved");
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel excluir a pagina do caderno.", error);
      setSaveStatus("error");
    }
  }

  const handleClose = useCallback(async () => {
    await saveNotebookInfoDraft();
    await saveActivePage();
    onClose();
  }, [saveNotebookInfoDraft, saveActivePage, onClose]);

  const enterFocusMode = useCallback(() => {
    setIsTagDropdownOpen(false);
    // O botao "Foco" vive no rodape, que vira uma .notebook-focus-bar: sem
    // largar o foco de teclado, o :focus-within dela a manteria acesa logo ao
    // entrar no modo — a barra so apagaria depois de um clique em outro lugar.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setIsFocusMode(true);
  }, []);

  const exitFocusMode = useCallback(() => {
    setIsFocusMode(false);
  }, []);

  const handleSpacingModeChange = useCallback(
    (mode: NotebookSpacingMode) => {
      const settingKey = isFocusMode ? notebookFocusSpacingSettingKey : notebookNormalSpacingSettingKey;

      if (isFocusMode) {
        setFocusSpacingMode(mode);
      } else {
        setNormalSpacingMode(mode);
      }

      void setSetting(settingKey, mode).catch((error) => {
        console.warn("Nao foi possivel salvar a preferencia de espacamento do caderno.", error);
      });
    },
    [isFocusMode],
  );

  const toggleMaximized = useCallback(() => {
    if (isMaximized) {
      const restoreState = restoreStateRef.current;

      if (restoreState) {
        setPanelSize(restoreState.size);
        setIsCollapsed(restoreState.collapsed);
        movePanel(panel.id, restoreState.position);
      }

      setIsMaximized(false);
      return;
    }

    restoreStateRef.current = {
      position: panel.position,
      size: panelSize,
      collapsed: isCollapsed,
    };
    setIsCollapsed(false);
    setPanelSize(getMaximizedPanelSize());
    movePanel(panel.id, { x: 0, y: 0 });
    setIsMaximized(true);
  }, [isCollapsed, isMaximized, movePanel, panel.id, panel.position, panelSize]);

  useEffect(() => {
    if (!initialMaximized || hasAppliedInitialMaximizedRef.current) {
      return;
    }

    restoreStateRef.current = {
      position: panel.position,
      size: panelSize,
      collapsed: isCollapsed,
    };
    hasAppliedInitialMaximizedRef.current = true;
    setIsCollapsed(false);
    setIsMaximized(true);
  }, [initialMaximized, isCollapsed, panel.position, panelSize]);

  useEffect(() => {
    if (!isMaximized) {
      return;
    }

    setPanelSize(getMaximizedPanelSize());
    movePanel(panel.id, { x: 0, y: 0 });

    function handleWindowResize() {
      setPanelSize(getMaximizedPanelSize());
      movePanel(panel.id, { x: 0, y: 0 });
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isMaximized, movePanel, panel.id]);

  // Esc fecha, nesta ordem, o que estiver "por cima": drawer de Detalhes,
  // modo foco, trilho de Paginas expandido; so entao fecha o painel — e apenas
  // quando ele e o TOPO da pilha, para nao fechar varios paineis com um Esc.
  // O drawer vem ANTES do modo foco porque agora ele pode abrir por cima dele:
  // sair do foco primeiro deixaria o drawer aberto para tras.
  // O menu "/" do editor ja trata o proprio Esc com preventDefault, entao o
  // guard de defaultPrevented no topo evita conflito com a Fase 2.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      const topPanel = panels[panels.length - 1];
      if (topPanel?.id === panel.id) {
        if (isPrintDialogOpen) {
          event.preventDefault();
          if (!isPreparingPrint) {
            closeNotebookPrintDialog();
          }
          return;
        }

        if (isDetailsPanelOpen) {
          event.preventDefault();
          setIsDetailsPanelOpen(false);
          return;
        }

        if (isFocusMode) {
          event.preventDefault();
          exitFocusMode();
          return;
        }

        if (isPagesRailExpanded) {
          event.preventDefault();
          setIsPagesRailExpanded(false);
          return;
        }

        void handleClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    panels,
    panel.id,
    handleClose,
    isFocusMode,
    exitFocusMode,
    isDetailsPanelOpen,
    isPagesRailExpanded,
    isPreparingPrint,
    isPrintDialogOpen,
  ]);

  // Colapsa o trilho de Paginas ao clicar fora dele — mesmo padrao do
  // clique-fora do drawer de Detalhes logo abaixo.
  useEffect(() => {
    if (!isPagesRailExpanded) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (event.target instanceof Node && pagesRailRef.current?.contains(event.target)) {
        return;
      }
      setIsPagesRailExpanded(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isPagesRailExpanded]);

  // Fecha o drawer de Detalhes ao clicar fora dele (fora tambem do proprio
  // botao "i" que o abre/fecha, senao o mousedown fecharia e o click do botao
  // reabriria em seguida).
  useEffect(() => {
    if (!isDetailsPanelOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) {
        return;
      }
      if (detailsColumnRef.current?.contains(event.target)) {
        return;
      }
      if (detailsToggleButtonRef.current?.contains(event.target)) {
        return;
      }
      setIsDetailsPanelOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isDetailsPanelOpen]);

  // Move o foco para dentro do drawer ao abrir e devolve para o botao "i" ao
  // fechar — sem isso o foco de teclado fica preso atras do overlay (aberto)
  // ou e perdido de vez (fechado). So dispara na TRANSICAO, nunca no mount.
  useEffect(() => {
    if (wasDetailsPanelOpenRef.current === isDetailsPanelOpen) {
      return;
    }
    wasDetailsPanelOpenRef.current = isDetailsPanelOpen;

    if (isDetailsPanelOpen) {
      // Aberto via "Renomear caderno": foca e seleciona o título. Caso normal:
      // foca o botão de fechar (foco de teclado dentro do overlay).
      if (pendingTitleFocusRef.current) {
        pendingTitleFocusRef.current = false;
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
      } else {
        detailsCloseButtonRef.current?.focus();
      }
    } else {
      detailsToggleButtonRef.current?.focus();
    }
  }, [isDetailsPanelOpen]);

  // Best-effort no unmount (ex.: app fechando o painel por outra via): salva
  // o que estiver sujo. saveActivePage e estavel (useCallback []), entao este
  // cleanup so roda no unmount real.
  useEffect(() => {
    return () => {
      void saveNotebookInfoDraft();
      void saveActivePage();
    };
  }, [saveNotebookInfoDraft, saveActivePage]);

  useEffect(() => {
    if (!isTagDropdownOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (event.target instanceof Node && notebookTagDropdownRef.current && !notebookTagDropdownRef.current.contains(event.target)) {
        setIsTagDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isTagDropdownOpen]);

  useEffect(() => {
    if (!isReadingStatusDropdownOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (event.target instanceof Node && readingStatusDropdownRef.current && !readingStatusDropdownRef.current.contains(event.target)) {
        setIsReadingStatusDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isReadingStatusDropdownOpen]);

  const activePage = pages.find((page) => page.id === activePageId) ?? null;
  const exportCurrentPageTitle = activePage ? pageDisplayTitle(activePage) : "Página atual";
  const exportPreparedScopeLabel =
    preparedExport?.scope === "current-page" ? "Página atual" : preparedExport?.scope === "full-notebook" ? "Caderno completo" : "";

  const currentCollectionName = collections.find((collection) => collection.id === infoDraftCollectionId)?.name ?? notebookInfo?.collectionName ?? "Sem título";
  const saveStatusText = getNotebookSaveStatusLabel(saveStatus);
  const readingStatusPercent = getReadingStatusPercent(infoDraftReadingStatus);
  const editorZoomScale = editorZoomPercent / 100;
  const activeSpacingMode = isFocusMode ? focusSpacingMode : normalSpacingMode;
  const activeContentInset = isFocusMode ? focusContentInset : contentInset;
  // O drawer de Detalhes tambem abre no modo foco: ele fica FORA do foco (nao
  // apaga, por nao ser uma .notebook-focus-bar), e o resto do painel continua
  // no modo foco normalmente.
  const shouldShowDetailsPanel = isDetailsPanelOpen;
  // Zoom com botoes - / + (passo pelos degraus discretos de editorZoomOptions),
  // no lugar do antigo dropdown — mesmo padrao do rodape da referencia.
  const currentZoomIndex = Math.max(0, editorZoomOptions.findIndex((option) => option === editorZoomPercent));
  const zoomControl = (
    <div className="inline-flex items-center gap-0.5">
      <button
        type="button"
        title="Reduzir zoom"
        aria-label="Reduzir zoom"
        disabled={currentZoomIndex <= 0}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-secondary transition hover:bg-surface-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => setEditorZoomPercent(editorZoomOptions[Math.max(0, currentZoomIndex - 1)])}
      >
        <MinusIcon />
      </button>
      <span className="min-w-10 text-center font-semibold tabular-nums text-text-primary">{editorZoomPercent}%</span>
      <button
        type="button"
        title="Ampliar zoom"
        aria-label="Ampliar zoom"
        disabled={currentZoomIndex >= editorZoomOptions.length - 1}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-secondary transition hover:bg-surface-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => setEditorZoomPercent(editorZoomOptions[Math.min(editorZoomOptions.length - 1, currentZoomIndex + 1)])}
      >
        <PlusIcon size={13} />
      </button>
    </div>
  );

  // Segmentado de espacamento (Compacto/Normal/Confortável/Amplo) no rodape,
  // reaproveitando o estado ja existente. O segmento ativo ganha fundo de card.
  const spacingControl = (
    <div className="inline-flex items-center rounded-full bg-surface-muted p-0.5">
      {notebookSpacingOptions.map((option) => {
        const isActive = activeSpacingMode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
              isActive ? "bg-[var(--card)] text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
            }`}
            onClick={() => handleSpacingModeChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <FloatingPanelFrame
      panel={panel}
      width={panelSize.width}
      height={isCollapsed ? collapsedHeight : panelSize.height}
      minWidth={notebookPanelMinWidth}
      minHeight={isCollapsed ? collapsedHeight : notebookPanelMinHeight}
      resizable={!isCollapsed && !isMaximized}
      edgeToEdge={isMaximized}
      onResize={setPanelSize}
      renderHeader={(startDragging) => (
        <div
          className={`flex h-10 shrink-0 items-center gap-2 border-b border-[var(--floating-header-border)] px-4 ${
            isFocusMode ? "notebook-focus-bar bg-[var(--notebook-focus-bar-bg)]" : "bg-[var(--floating-header-bg)]"
          } ${isMaximized ? "" : "cursor-move"}`}
          onMouseDown={isMaximized ? undefined : startDragging}
        >
          {/* Status de salvamento a esquerda (ponto colorido + rotulo), como na
              referencia; o breadcrumb agora vive acima do titulo, no conteudo. */}
          <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-[var(--floating-header-muted)]">
            <span
              aria-hidden="true"
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                saveStatus === "saved" ? "bg-status-green-text" : saveStatus === "error" ? "bg-status-red-text" : "bg-text-subtle"
              }`}
            />
            <span className="truncate">{saveStatusText}</span>
          </span>
          <span className="flex-1" aria-hidden="true" />
          <div className="flex items-center justify-end gap-1" onMouseDown={(event) => event.stopPropagation()}>
            <button
              ref={detailsToggleButtonRef}
              type="button"
              aria-label={isDetailsPanelOpen ? "Fechar informações do caderno" : "Informações do caderno"}
              title={isDetailsPanelOpen ? "Fechar informações do caderno" : "Informações do caderno"}
              aria-pressed={shouldShowDetailsPanel}
              className={`rounded-md p-1.5 transition hover:bg-[var(--floating-header-hover-bg)] ${
                shouldShowDetailsPanel ? "text-[var(--floating-header-text)]" : "text-[var(--floating-header-control)]"
              }`}
              onClick={() => setIsDetailsPanelOpen((current) => !current)}
            >
              <InfoIcon />
            </button>
            <button
              type="button"
              aria-label="Mais opções"
              title="Mais opções"
              aria-haspopup="menu"
              aria-expanded={notebookOptionsContextMenu.isOpen}
              className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onClick={(event) => openNotebookOptionsMenu(event, "header")}
            >
              <MoreVerticalIcon />
            </button>
            <button
              type="button"
              aria-label={isCollapsed ? "Restaurar painel" : "Minimizar painel"}
              title={isCollapsed ? "Restaurar painel" : "Minimizar painel"}
              className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onClick={() => setIsCollapsed((current) => !current)}
            >
              <MinimizeIcon />
            </button>
            <button
              type="button"
              aria-label={isMaximized ? "Restaurar painel" : "Maximizar painel"}
              title={isMaximized ? "Restaurar painel" : "Maximizar painel"}
              className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onClick={toggleMaximized}
            >
              {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button
              type="button"
              aria-label="Fechar painel"
              title="Fechar painel"
              className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onClick={() => void handleClose()}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
    >
      {isCollapsed ? null : isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm font-semibold text-text-secondary">
          Carregando caderno
        </div>
      ) : loadError || !activePage ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm font-semibold text-status-red-text">
          Não foi possível carregar o caderno.
        </div>
      ) : (
        // Superficie de escrita usa --background (#F5EDE4 no claro), nao o
        // --card quase branco: blocos como callout/tabela ficam em --card e
        // passam a se destacar sobre a pagina. O trilho tem bg-sidebar e o
        // rodape/drawer definem o proprio fundo, entao nao sao afetados.
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-surface-app">
          {/* ================= COLUNA 1: TRILHO DE PAGINAS ================= */}
          {/* Trilho colapsavel: nasce estreito (so os dots) e expande revelando
              os titulos. shrink-0 + largura fixa => o editor (flex-1) reflui de
              verdade quando expande, ao contrario do drawer de Detalhes. Fora
              do modo foco ele esta sempre presente (recolhido, nao escondido). */}
          <aside
            ref={pagesRailRef}
            style={{ width: isPagesRailExpanded ? notebookPagesRailExpandedWidth : notebookPagesRailCollapsedWidth }}
            className={`flex shrink-0 flex-col overflow-hidden border-r border-sidebar-border transition-[width] duration-200 ${
              isFocusMode ? "notebook-focus-bar bg-[var(--notebook-focus-rail-bg)]" : "bg-sidebar"
            }`}
          >
            {/* Cabecalho: seta SEMPRE visivel (mesmo colapsado), apontando para
                onde o trilho vai — ">" abre, "<" recolhe. O rotulo "Páginas"
                aparece so no expandido. */}
            <div className="flex h-[52px] shrink-0 items-center gap-3 px-3">
              <button
                type="button"
                aria-label={isPagesRailExpanded ? "Recolher lista de páginas" : "Expandir lista de páginas"}
                aria-expanded={isPagesRailExpanded}
                title={isPagesRailExpanded ? "Recolher páginas" : "Expandir páginas"}
                onClick={() => setIsPagesRailExpanded((current) => !current)}
                className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-sidebar-muted transition hover:bg-sidebar-raised hover:text-sidebar-text"
              >
                <ChevronRightIcon size={18} className={`transition-transform duration-200 ${isPagesRailExpanded ? "rotate-180" : ""}`} />
              </button>
              <span
                aria-hidden={!isPagesRailExpanded}
                className={`min-w-0 flex-1 truncate text-[11px] font-bold uppercase tracking-[0.08em] text-sidebar-muted transition-opacity duration-150 ${
                  isPagesRailExpanded ? "opacity-100" : "opacity-0"
                }`}
              >
                Páginas
              </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 pb-3 pt-0.5">
              {pages.map((page) => {
                const isActivePage = page.id === activePageId;

                return (
                  <button
                    key={page.id}
                    type="button"
                    onClick={() => void switchToPage(page.id)}
                    onContextMenu={(event) => {
                      event.stopPropagation();
                      setContextPageId(page.id);
                      pageContextMenu.open(event);
                    }}
                    aria-current={isActivePage}
                    title={pageDisplayTitle(page)}
                    className="flex items-center gap-3 rounded-lg px-0 py-1.5 text-left transition hover:bg-sidebar-raised"
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        background: pageDotColor(page.id),
                        boxShadow: isActivePage ? "0 0 0 2px var(--sidebar), 0 0 0 4px var(--primary)" : undefined,
                      }}
                      className="h-[30px] w-[30px] shrink-0 rounded-full"
                    />
                    <span
                      className={`min-w-0 flex-1 truncate text-[13px] transition-opacity duration-150 ${
                        isPagesRailExpanded ? "opacity-100" : "opacity-0"
                      } ${isActivePage ? "font-semibold text-sidebar-text" : "font-medium text-sidebar-muted"}`}
                    >
                      {pageDisplayTitle(page)}
                    </span>
                  </button>
                );
              })}

              {/* "+" tracejado: acessivel colapsado (so o circulo) e expandido
                  (com o rotulo). Mantem addPage, sem forcar expansao. */}
              <button
                type="button"
                onClick={() => void addPage()}
                aria-label="Nova página"
                title="Nova página"
                className="mt-1 flex items-center gap-3 rounded-lg px-0 py-1.5 text-left text-sidebar-muted transition hover:text-sidebar-text"
              >
                <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-dashed border-sidebar-border">
                  <PlusIcon size={15} />
                </span>
                <span
                  className={`min-w-0 flex-1 truncate text-[13px] font-medium transition-opacity duration-150 ${
                    isPagesRailExpanded ? "opacity-100" : "opacity-0"
                  }`}
                >
                  Nova página
                </span>
              </button>
            </div>
          </aside>

          {/* ================= COLUNA 2: EDITOR ================= */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className={`flex shrink-0 flex-col ${activeContentInset}`}>
              {/* Breadcrumb no conteudo (acima do titulo), como na referencia —
                  saiu do header, que agora mostra so o status de salvamento. */}
              {!isFocusMode ? (
                <nav
                  aria-label="Localização do caderno"
                  className="flex min-w-0 items-center gap-1.5 pr-5 pt-7 text-xs font-medium text-text-subtle"
                >
                  <span className="truncate">Minha Biblioteca</span>
                  <BreadcrumbChevronIcon />
                  <span className="truncate">{currentCollectionName}</span>
                  <BreadcrumbChevronIcon />
                  <span className="truncate font-semibold text-text-secondary">{notebookTitle || "Caderno"}</span>
                </nav>
              ) : null}
              <input
                value={draftTitle}
                onChange={(event) => {
                  setDraftTitle(event.target.value);
                  draftTitleRef.current = event.target.value;
                  isDirtyRef.current = true;
                  setSaveStatus("dirty");
                  scheduleAutosave();
                }}
                onBlur={() => void saveActivePage()}
                placeholder={`Página sem título ${activePage.position}`}
                aria-label="Título da página"
                style={{ fontSize: `${28 * editorZoomScale}px` }}
                className={`min-w-0 border-0 bg-transparent pb-2 pr-5 font-serif text-[28px] font-medium leading-tight text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] ${
                  isFocusMode ? "pt-7" : "pt-2"
                }`}
              />
            </div>

            <NotebookPageEditor
              key={activePage.id}
              notebookId={notebookId}
              pageId={activePage.id}
              initialContent={activePage.content}
              contentInsetClassName={activeContentInset}
              isFocusMode={isFocusMode}
              spacingMode={activeSpacingMode}
              zoomPercent={editorZoomPercent}
              linkedDocuments={linkedDocuments}
              onOpenPdfPicker={() => setIsPickerOpen(true)}
              onSpacingModeChange={handleSpacingModeChange}
              onContentChange={(html) => {
                draftContentRef.current = html;
                setEditorStats(getEditorStatsFromHtml(html));
                isDirtyRef.current = true;
                setSaveStatus("dirty");
                scheduleAutosave();
              }}
              onBlur={() => void saveActivePage()}
            />

            <div
              className={`flex h-10 shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-4 text-xs text-text-secondary ${
                isFocusMode ? "notebook-focus-bar bg-[var(--notebook-focus-bar-bg)]" : "bg-[var(--card)]"
              }`}
            >
              {isFocusMode ? (
                <>
                  {/* Sem status de salvamento aqui: ele vive so no header. */}
                  <div className="flex min-w-0 items-center gap-2">
                    <span>{formatCount(editorStats.words)} palavras</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      className="inline-flex items-center rounded-full px-3 py-1 font-semibold text-primary transition hover:bg-primary-soft"
                      onClick={exitFocusMode}
                    >
                      Sair do foco · Esc
                    </button>
                    <span className="h-4 w-px bg-border-subtle" aria-hidden="true" />
                    {spacingControl}
                    <span className="h-4 w-px bg-border-subtle" aria-hidden="true" />
                    {zoomControl}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span>{formatCount(editorStats.words)} {editorStats.words === 1 ? "palavra" : "palavras"}</span>
                    <span className="text-text-subtle" aria-hidden="true">·</span>
                    <span>{pages.length} {pages.length === 1 ? "página" : "páginas"}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      onClick={enterFocusMode}
                      title="Entrar no modo foco"
                      className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle px-3 py-1 font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                    >
                      <FocusModeIcon />
                      Foco
                    </button>
                    <span className="h-4 w-px bg-border-subtle" aria-hidden="true" />
                    {spacingControl}
                    <span className="h-4 w-px bg-border-subtle" aria-hidden="true" />
                    {zoomControl}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ================= COLUNA 3: DETALHES ================= */}
          {shouldShowDetailsPanel ? (
            <aside
              ref={detailsColumnRef}
              style={{ width: notebookDetailsColumnWidth, maxWidth: "calc(100% - 3rem)" }}
              className="absolute bottom-0 right-0 top-0 z-30 flex flex-col overflow-hidden border-l border-border-strong bg-[var(--card)]"
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <SectionLabel>Detalhes</SectionLabel>
                <button
                  ref={detailsCloseButtonRef}
                  type="button"
                  aria-label="Fechar informações do caderno"
                  title="Fechar informações do caderno"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                  onClick={() => setIsDetailsPanelOpen(false)}
                >
                  <CloseIcon />
                </button>
              </div>

              {/* 1. Status de leitura — sempre no topo. Pílula (statusTokens)
                  abre um dropdown para trocar o status; barra reaproveita o
                  ProgressBar compartilhado do Reader. */}
              <NotebookInfoField label="Status de leitura">
                <div className="rounded-lg border border-border-subtle bg-surface-app px-3.5 py-3.5">
                  <div className="relative" ref={readingStatusDropdownRef}>
                    <button
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={isReadingStatusDropdownOpen}
                      onClick={() => setIsReadingStatusDropdownOpen((current) => !current)}
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold ${statusTokens[infoDraftReadingStatus].className}`}
                    >
                      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusTokens[infoDraftReadingStatus].dotClassName}`} />
                      {statusTokens[infoDraftReadingStatus].label}
                      <ChevronDownIcon />
                    </button>

                    {isReadingStatusDropdownOpen ? (
                      <div role="menu" className="absolute left-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-border-muted bg-surface-panel p-1 shadow-lg">
                        {notebookReadingStatusOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            role="menuitemradio"
                            aria-checked={infoDraftReadingStatus === option.value}
                            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs font-semibold transition ${
                              infoDraftReadingStatus === option.value ? "bg-primary-soft text-primary" : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                            }`}
                            onClick={() => {
                              setInfoDraftReadingStatus(option.value);
                              infoDraftReadingStatusRef.current = option.value;
                              isInfoDirtyRef.current = true;
                              setSaveStatus("dirty");
                              scheduleAutosave();
                              setIsReadingStatusDropdownOpen(false);
                              void saveNotebookInfoDraft();
                            }}
                          >
                            <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusTokens[option.value].dotClassName}`} />
                            {option.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-3 flex items-center gap-3">
                    <ProgressBar value={readingStatusPercent} showValue={false} />
                    <span className="min-w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-text-secondary">{readingStatusPercent}%</span>
                  </div>
                </div>
              </NotebookInfoField>

              {/* 2. Disciplina — campo author_discipline, com a disciplina como
                  rótulo principal. */}
              <NotebookInfoField label="Disciplina">
                <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-[var(--card)] px-3 text-text-secondary focus-within:border-primary">
                  <span className="shrink-0 text-text-subtle">
                    <OpenBookIcon />
                  </span>
                  <input
                    value={infoDraftAuthorDiscipline}
                    onChange={(event) => {
                      setInfoDraftAuthorDiscipline(event.target.value);
                      infoDraftAuthorDisciplineRef.current = event.target.value;
                      isInfoDirtyRef.current = true;
                      setSaveStatus("dirty");
                      scheduleAutosave();
                    }}
                    onBlur={() => void saveNotebookInfoDraft()}
                    placeholder="Disciplina ou autor..."
                    className="min-w-0 flex-1 border-0 bg-transparent py-2.5 text-sm font-medium text-text-primary outline-none placeholder:text-text-subtle"
                  />
                </div>
              </NotebookInfoField>

              {/* 3. Tags — pílulas de fill sólido (TagBadge), remoção embutida. */}
              <NotebookInfoField label="Tags">
                <div className="relative" ref={notebookTagDropdownRef}>
                  <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    {notebookTags.map((tag) => (
                      <TagBadge key={tag} tag={tag} onRemove={() => void handleTagsChange(notebookTags.filter((currentTag) => currentTag !== tag))} />
                    ))}

                    <button
                      type="button"
                      className="inline-flex items-center rounded-full border border-dashed border-border-subtle px-2.5 py-0.5 text-[11px] font-medium text-text-secondary transition hover:border-primary hover:text-text-primary"
                      onClick={() => setIsTagDropdownOpen((current) => !current)}
                    >
                      + Tag
                    </button>
                  </div>

                  {isTagDropdownOpen ? (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border-muted bg-surface-panel p-3 shadow-lg">
                      <TagSelector
                        availableTags={availableTags}
                        selectedTags={notebookTags}
                        onAvailableTagsChange={onAvailableTagsChange}
                        onSelectedTagsChange={(tags) => void handleTagsChange(tags)}
                      />
                    </div>
                  ) : null}
                </div>
              </NotebookInfoField>

              {/* 4. PDFs vinculados — cada um como CompactDocumentCard. */}
              <NotebookInfoField label="PDFs vinculados">
                {linkedDocuments.length === 0 ? (
                  <p className="text-sm text-text-secondary">Nenhum PDF vinculado</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {linkedDocuments.map((document) => (
                      <li key={document.id}>
                        <CompactDocumentCard
                          title={document.title}
                          authors={document.authors}
                          year={document.year}
                          trailingAction={
                            <button
                              type="button"
                              aria-label={`Desvincular ${document.title}`}
                              title="Desvincular"
                              className="rounded-md p-1 text-text-subtle opacity-0 transition hover:bg-surface-muted hover:text-status-red-text focus-visible:opacity-100 group-hover:opacity-100"
                              onClick={() => void handleUnlinkDocument(document.id)}
                            >
                              <CloseIcon />
                            </button>
                          }
                        />
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  onClick={() => setIsPickerOpen(true)}
                  className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border-subtle bg-[var(--card)] px-3 py-2 text-xs font-semibold text-primary transition hover:border-primary"
                >
                  <AttachIcon size={13} />
                  Vincular PDF
                </button>
              </NotebookInfoField>

              {/* 5. Caderno — título, coleção e descrição continuam editáveis,
                  agrupados aqui (fora do topo, que agora é o status). */}
              <NotebookInfoField label="Caderno">
                <input
                  ref={titleInputRef}
                  value={infoDraftTitle}
                  onChange={(event) => {
                    setInfoDraftTitle(event.target.value);
                    infoDraftTitleRef.current = event.target.value;
                    isInfoDirtyRef.current = true;
                    setSaveStatus("dirty");
                    scheduleAutosave();
                  }}
                  onBlur={() => void saveNotebookInfoDraft()}
                  placeholder="Caderno sem título"
                  className="h-10 w-full rounded-md border border-border-subtle bg-[var(--card)] px-3 text-sm font-medium text-text-primary outline-none focus:border-primary"
                />
              </NotebookInfoField>

              <NotebookInfoField label="Coleção">
                <div className="relative flex min-h-10 items-center gap-2 rounded-md border border-border-subtle bg-[var(--card)] px-3 text-text-secondary focus-within:border-primary">
                  <MenuGlyph name="folder" />
                  <select
                    value={infoDraftCollectionId}
                    onChange={(event) => {
                      setInfoDraftCollectionId(event.target.value);
                      infoDraftCollectionIdRef.current = event.target.value;
                      isInfoDirtyRef.current = true;
                      setSaveStatus("dirty");
                      void saveNotebookInfoDraft();
                    }}
                    className="min-w-0 flex-1 appearance-none border-0 bg-transparent py-2.5 pr-7 text-sm font-medium text-text-primary outline-none"
                  >
                    {collections.map((collection) => (
                      <option key={collection.id} value={collection.id} className={notebookSelectOptionClassName} style={notebookSelectOptionStyle}>
                        {collection.name}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-3 text-text-subtle">
                    <ChevronDownIcon />
                  </span>
                </div>
              </NotebookInfoField>

              <NotebookInfoField label="Descrição">
                <textarea
                  value={infoDraftDescription}
                  onChange={(event) => {
                    setInfoDraftDescription(event.target.value);
                    infoDraftDescriptionRef.current = event.target.value;
                    isInfoDirtyRef.current = true;
                    setSaveStatus("dirty");
                    scheduleAutosave();
                  }}
                  onBlur={() => void saveNotebookInfoDraft()}
                  placeholder="Descreva seu caderno..."
                  className="h-24 w-full resize-y rounded-md border border-border-subtle bg-surface-app px-3 py-3 text-sm font-normal text-text-primary outline-none placeholder:text-text-subtle focus:border-primary"
                />
              </NotebookInfoField>

              {/* 6. Datas — só criado/atualizado, no final. */}
              <div className="mt-6 border-t border-dashed border-border-subtle pt-5">
                <dl className="grid gap-3 text-xs">
                  <div className="grid grid-cols-[1fr_auto] gap-3">
                    <dt className="font-bold text-text-secondary">Criado</dt>
                    <dd className="text-right font-medium text-text-primary">
                      {notebookInfo ? formatNotebookDate(notebookInfo.createdAt) : "--"}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-3">
                    <dt className="font-bold text-text-secondary">Atualizado</dt>
                    <dd className="text-right font-medium text-text-primary">
                      {notebookInfo ? formatNotebookDate(notebookInfo.updatedAt) : "--"}
                    </dd>
                  </div>
                </dl>
              </div>

              </div>
            </aside>
          ) : null}

          {/* Menu de opções do caderno: montado no nível do corpo do painel
              (fora do drawer de Detalhes), senão ficaria desmontado quando o
              drawer está fechado e o "..." do header não abriria nada. Usa
              portal para document.body, então a posição na árvore não afeta o
              layout — é acionado tanto pelo "..." do header quanto pelo do
              rodapé do drawer. */}
          <ContextMenu
            isOpen={notebookOptionsContextMenu.isOpen}
            x={notebookOptionsContextMenu.x}
            y={notebookOptionsContextMenu.y}
            onClose={notebookOptionsContextMenu.close}
          >
            <ContextMenuItem icon={<MenuGlyph name="edit" />} label="Renomear caderno" onSelect={focusNotebookTitle} />
            <ContextMenuSubmenu
              icon={<MenuGlyph name="folder" />}
              label="Mover para coleção"
              collections={collections}
              onSelect={(collectionId) => void moveNotebookFromOptions(collectionId)}
              onClose={notebookOptionsContextMenu.close}
            />
            <ContextMenuItem icon={<MenuGlyph name="copy" />} label="Duplicar" onSelect={() => undefined} disabled />
            <ContextMenuItem icon={<MenuGlyph name="pin" />} label="Fixar nos favoritos" onSelect={() => void pinNotebookFavorite()} disabled={Boolean(notebookInfo?.favorite)} />
            <ContextMenuDivider />
            <ContextMenuItem icon={<MenuGlyph name="export" />} label="Exportar" onSelect={openNotebookExportDialog} />
            <ContextMenuItem icon={<MenuGlyph name="print" />} label="Imprimir" onSelect={openNotebookPrintDialog} />
            <ContextMenuItem icon={<MenuGlyph name="link" />} label="Copiar link interno" onSelect={() => undefined} disabled />
            <ContextMenuDivider />
            <ContextMenuItem icon={<MenuGlyph name="history" />} label="Histórico de alterações" onSelect={() => undefined} disabled />
            <ContextMenuItem icon={<MenuGlyph name="stats" />} label="Contagem detalhada" onSelect={openDetailedCount} />
            <ContextMenuDivider />
            <ContextMenuItem icon={<TrashIcon size={16} />} label="Mover para a lixeira" variant="danger" onSelect={() => void moveNotebookToTrashFromOptions()} />
          </ContextMenu>
        </div>
      )}

      {isStatsDialogOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay-modal p-6" role="presentation" onMouseDown={() => setIsStatsDialogOpen(false)}>
          <section
            className="w-full max-w-sm rounded-xl bg-surface-panel shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notebook-stats-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="border-b border-border-subtle px-6 py-5">
              <h2 id="notebook-stats-title" className="text-lg font-bold text-text-primary">
                Contagem detalhada
              </h2>
            </header>
            <dl className="grid gap-3 px-6 py-5 text-sm">
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <dt className="font-semibold text-text-secondary">Palavras</dt>
                <dd className="font-semibold text-text-primary">{formatCount(editorStats.words)}</dd>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <dt className="font-semibold text-text-secondary">Caracteres</dt>
                <dd className="font-semibold text-text-primary">{formatCount(editorStats.characters)}</dd>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <dt className="font-semibold text-text-secondary">Páginas</dt>
                <dd className="font-semibold text-text-primary">{formatCount(pages.length)}</dd>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-3">
                <dt className="font-semibold text-text-secondary">PDFs vinculados</dt>
                <dd className="font-semibold text-text-primary">{formatCount(linkedDocuments.length)}</dd>
              </div>
            </dl>
            <footer className="flex justify-end border-t border-border-subtle px-6 py-4">
              <button
                type="button"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover"
                onClick={() => setIsStatsDialogOpen(false)}
              >
                Fechar
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {isPrintDialogOpen ? (
        <NotebookPrintModal
          pages={pages}
          currentPageId={activePageIdRef.current}
          isPreparing={isPreparingPrint}
          error={printError}
          onCancel={closeNotebookPrintDialog}
          onConfirm={(pageIds) => void prepareNotebookPrint(pageIds)}
        />
      ) : null}

      {printJob ? <PrintableNotebookView pages={printJob.pages} onReady={triggerNotebookPrint} /> : null}

      {isExportDialogOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay-modal p-6" role="presentation" onMouseDown={closeNotebookExportDialog}>
          <section
            className="w-full max-w-md rounded-xl bg-surface-panel shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="notebook-export-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="border-b border-border-subtle px-6 py-5">
              <h2 id="notebook-export-title" className="text-lg font-bold text-text-primary">
                Exportar Caderno
              </h2>
            </header>

            <div className="grid gap-5 px-6 py-5 text-sm">
              <fieldset className="grid gap-3">
                <legend className="text-xs font-bold uppercase tracking-wide text-text-secondary">Escopo</legend>
                <label className="grid cursor-pointer grid-cols-[auto_1fr] gap-3 rounded-lg border border-border-subtle bg-[var(--card)] px-4 py-3 transition hover:border-primary">
                  <input
                    type="radio"
                    name="notebook-export-scope"
                    value="current-page"
                    checked={exportScope === "current-page"}
                    disabled={!activePage}
                    onChange={() => {
                      setExportScope("current-page");
                      setExportError(null);
                      setPreparedExport(null);
                      setHasConfirmedLargeExport(false);
                      setExportResult(null);
                    }}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block font-semibold text-text-primary">Página atual</span>
                    <span className="block truncate text-xs text-text-secondary" title={exportCurrentPageTitle}>
                      {exportCurrentPageTitle}
                    </span>
                  </span>
                </label>
                <label className="grid cursor-pointer grid-cols-[auto_1fr] gap-3 rounded-lg border border-border-subtle bg-[var(--card)] px-4 py-3 transition hover:border-primary">
                  <input
                    type="radio"
                    name="notebook-export-scope"
                    value="full-notebook"
                    checked={exportScope === "full-notebook"}
                    onChange={() => {
                      setExportScope("full-notebook");
                      setExportError(null);
                      setPreparedExport(null);
                      setHasConfirmedLargeExport(false);
                      setExportResult(null);
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="block font-semibold text-text-primary">Caderno completo</span>
                    <span className="block text-xs text-text-secondary">
                      {formatCount(pages.length)} {pages.length === 1 ? "página" : "páginas"}
                    </span>
                  </span>
                </label>
              </fieldset>

              {exportError ? (
                <div className="rounded-lg border border-status-red bg-status-red-soft px-4 py-3 text-sm font-medium text-status-red-text">
                  {exportError}
                </div>
              ) : null}

              {preparedExport ? (
                <div className="grid gap-2 rounded-lg border border-border-subtle bg-surface-card px-4 py-3">
                  <p className="font-semibold text-text-primary">Exportação preparada</p>
                  <p className="text-xs text-text-secondary">
                    {exportPreparedScopeLabel} - {formatCount(preparedExport.pageIds.length)}{" "}
                    {preparedExport.pageIds.length === 1 ? "página" : "páginas"}
                  </p>
                  <p className="text-xs text-text-secondary">
                    Manifest: {formatCount(preparedExport.manifestSlotCount)}{" "}
                    {preparedExport.manifestSlotCount === 1 ? "sentinela" : "sentinelas"}
                    {preparedExport.warnings.length > 0 ? ` - ${formatCount(preparedExport.warnings.length)} avisos` : ""}
                  </p>
                  <p className="text-xs text-text-secondary">
                    Tamanho estimado:{" "}
                    {preparedExport.estimatedSizeBytes !== null ? (
                      <span className="font-medium text-text-primary">~{formatExportFileSize(preparedExport.estimatedSizeBytes)}</span>
                    ) : (
                      "indisponível"
                    )}
                  </p>
                  {preparedExport.warnings.length > 0 ? (
                    <ul className="grid gap-1 text-xs text-text-secondary">
                      {preparedExport.warnings.map((warning, index) => (
                        <li key={`${warning.code}-${warning.pageId}-${index}`} className="break-words [overflow-wrap:anywhere]">
                          {formatNotebookExportBuildWarning(warning)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="break-words text-xs font-medium text-text-primary [overflow-wrap:anywhere] [word-break:break-word]" title={preparedExport.destinationPath}>
                    {preparedExport.destinationPath}
                  </p>
                  {preparedExport.isAboveSizeThreshold && !exportResult ? (
                    <div className="mt-1 grid gap-2 rounded-lg border border-accent-icon-amber border-l-4 bg-surface-muted px-3 py-2.5">
                      {/* Mesmo banner/checkbox nos dois casos; so o texto muda
                          conforme a causa do gate (tamanho grande vs. estimativa
                          que nao pode ser calculada). */}
                      <p className="text-xs font-bold text-text-primary">
                        {preparedExport.estimatedSizeBytes === null ? "Estimativa indisponível" : "Exportação grande"}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {preparedExport.estimatedSizeBytes === null
                          ? "Não foi possível estimar o tamanho deste export. Ele pode ser grande e demorar para gravar e para abrir. Deseja continuar mesmo assim?"
                          : "O tamanho estimado ultrapassa 100 MB. Arquivos grandes podem demorar para gravar e para abrir no navegador."}
                      </p>
                      <label className="grid cursor-pointer grid-cols-[auto_1fr] items-start gap-2">
                        <input
                          type="checkbox"
                          checked={hasConfirmedLargeExport}
                          onChange={(event) => setHasConfirmedLargeExport(event.target.checked)}
                          className="mt-0.5"
                        />
                        <span className="text-xs text-text-secondary">
                          {preparedExport.estimatedSizeBytes === null
                            ? "Entendo e quero exportar mesmo assim."
                            : "Entendo o tamanho e quero exportar mesmo assim."}
                        </span>
                      </label>
                    </div>
                  ) : null}
                  {!exportResult && !(preparedExport.isAboveSizeThreshold && !hasConfirmedLargeExport) ? (
                    <p className="text-xs text-text-secondary">Clique em Exportar para gravar o arquivo HTML.</p>
                  ) : null}
                </div>
              ) : null}

              {exportResult ? (
                <div className="grid gap-2 rounded-lg border border-border-subtle bg-surface-card px-4 py-3">
                  <p className="font-semibold text-status-green-text">Exportação concluída</p>
                  <p className="text-xs text-text-secondary">
                    {formatCount(exportResult.embeddedAssets)}{" "}
                    {exportResult.embeddedAssets === 1 ? "imagem incorporada" : "imagens incorporadas"} -{" "}
                    {formatCount(exportResult.embeddedAttachments)}{" "}
                    {exportResult.embeddedAttachments === 1 ? "anexo incorporado" : "anexos incorporados"}
                  </p>
                  <p className="text-xs text-text-secondary">{formatExportFileSize(exportResult.bytesWritten)}</p>
                  {exportResult.missingResources > 0 ? (
                    <p className="text-xs text-text-secondary">
                      {formatCount(exportResult.missingResources)}{" "}
                      {exportResult.missingResources === 1 ? "recurso indisponível" : "recursos indisponíveis"}
                    </p>
                  ) : null}
                  {exportResult.warnings.length > 0 ? (
                    <div className="grid gap-1 text-xs text-text-secondary">
                      <p>
                        {formatCount(exportResult.warnings.length)}{" "}
                        {exportResult.warnings.length === 1 ? "aviso" : "avisos"}
                      </p>
                      <ul className="grid gap-1">
                        {exportResult.warnings.map((warning, index) => (
                          <li key={`${warning.code}-${warning.slotId ?? "sem-slot"}-${index}`} className="break-words [overflow-wrap:anywhere]">
                            {formatNotebookExportWriteWarning(warning)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <p className="break-words text-xs font-medium text-text-primary [overflow-wrap:anywhere] [word-break:break-word]" title={exportResult.path}>
                    {exportResult.path}
                  </p>
                </div>
              ) : null}
            </div>

            <footer className="flex items-center justify-end gap-3 border-t border-border-subtle px-6 py-4">
              <button
                type="button"
                disabled={isPreparingExport || isWritingExport}
                className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-bold text-text-secondary transition hover:border-primary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                onClick={closeNotebookExportDialog}
              >
                {preparedExport || exportResult ? "Fechar" : "Cancelar"}
              </button>
              {preparedExport && !exportResult ? (
                <button
                  type="button"
                  disabled={isPreparingExport || isWritingExport}
                  className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-bold text-text-secondary transition hover:border-primary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void prepareNotebookExport()}
                >
                  {isPreparingExport ? "Preparando..." : "Trocar destino"}
                </button>
              ) : null}
              {!exportResult ? (
                <button
                  type="button"
                  disabled={
                    isPreparingExport ||
                    isWritingExport ||
                    // Acima do limiar de tamanho, "Exportar" so habilita apos a
                    // confirmacao explicita no aviso. Nao afeta "Selecionar
                    // destino" (quando ainda nao ha preparacao).
                    Boolean(preparedExport?.isAboveSizeThreshold && !hasConfirmedLargeExport)
                  }
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => (preparedExport ? void runNotebookExport() : void prepareNotebookExport())}
                >
                  {preparedExport
                    ? isWritingExport
                      ? "Exportando..."
                      : "Exportar"
                    : isPreparingExport
                      ? "Preparando..."
                      : "Selecionar destino"}
                </button>
              ) : null}
            </footer>
          </section>
        </div>
      ) : null}

      <ContextMenu isOpen={pageContextMenu.isOpen} x={pageContextMenu.x} y={pageContextMenu.y} onClose={pageContextMenu.close}>
        <ContextMenuItem
          icon={<TrashIcon size={16} />}
          label="Excluir permanentemente"
          variant="danger"
          onSelect={() => void deleteContextPage()}
        />
      </ContextMenu>

      {isPickerOpen ? (
        <DocumentPickerModal
          documents={documents}
          linkedDocumentIds={new Set(linkedDocuments.map((document) => document.id))}
          onPick={(documentId) => void handleAttachDocument(documentId)}
          onClose={() => setIsPickerOpen(false)}
        />
      ) : null}
    </FloatingPanelFrame>
  );
}
