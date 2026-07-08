import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { ContextMenuDivider } from "../../components/ui/ContextMenuDivider";
import { ContextMenuItem } from "../../components/ui/ContextMenuItem";
import { ContextMenuSubmenu } from "../../components/ui/ContextMenuSubmenu";
import { TrashIcon } from "../../components/ui/SharedIcons";
import { SectionLabel } from "../../components/ui/SectionLabel";
import { TagBadge } from "../../components/TagBadge";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { useFloatingPanels, type FloatingPanel } from "../../components/floating/FloatingPanelsContext";
import {
  createNotebookPage,
  deleteNotebookPage,
  getNotebookInfo,
  getSetting,
  linkDocumentToNotebook,
  listNotebookLinkedDocuments,
  listNotebookPages,
  listNotebookTags,
  moveNotebookToTrash as movePersistedNotebookToTrash,
  saveNotebookPage,
  saveNotebookTags,
  selectNotebookExportDestination,
  setNotebookFavorite,
  setSetting,
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
import type { LibraryCollection, LibraryDocument, NotebookPage, SubjectTag } from "../../types/library";
import { DocumentPickerModal } from "../library/DocumentPickerModal";
import { TagSelector } from "../library/TagSelector";
import { getNotebookExportDefaultFileName } from "./notebookExportFileName";
import { buildNotebookExportHtml, type NotebookExportBuildResult, type NotebookExportScope, type NotebookExportWarning } from "./notebookExportHtml";
import { NotebookPageEditor, notebookSpacingOptions, type NotebookSpacingMode } from "./NotebookPageEditor";
import {
  notebookDetailsCollapseBreakpoint,
  notebookDetailsColumnWidth,
  notebookEditorMinWidth,
  notebookPagesColumnWidth,
  notebookPanelHeight,
  notebookPanelMinHeight,
  notebookPanelMinWidth,
  notebookPanelWidth,
} from "./notebookPanelDimensions";

const contentInset = "mx-auto w-full max-w-[760px] px-6";
const focusContentInset = "mx-auto w-full max-w-[720px] px-6";
const notebookNormalSpacingSettingKey = "notebook_spacing_normal";
const notebookFocusSpacingSettingKey = "notebook_spacing_focus";
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
  scope: NotebookExportScope;
  pageIds: number[];
  destinationPath: string;
  build: NotebookExportBuildResult;
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

function formatExportFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${formatCount(bytes)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${formatCount(Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatNotebookExportBuildWarning(warning: NotebookExportWarning) {
  return warning.message;
}

function formatNotebookExportWriteWarning(warning: NotebookExportWriteWarning) {
  const location = [warning.slotId, warning.pageId ? `página ${warning.pageId}` : null].filter(Boolean).join(" - ");

  return location ? `${warning.message} (${location})` : warning.message;
}

function NotebookHeaderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3z" />
      <path d="M9 7h7" />
      <path d="M9 11h5" />
    </svg>
  );
}

function BreadcrumbChevronIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function SavedIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
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

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" x2="16.65" y1="21" y2="16.65" />
    </svg>
  );
}

function PdfIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
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

// Icone do botao que mostra/esconde a coluna de Paginas (esquerda): retangulo
// do painel com a coluna ESQUERDA destacada. Espelho do DetailsToggleIcon.
function PagesToggleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="9" x2="9" y1="4" y2="20" />
    </svg>
  );
}

// Icone do botao que mostra/esconde a coluna de Detalhes: retangulo do painel
// com a coluna DIREITA destacada — glifo comum para "toggle sidebar".
function DetailsToggleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="15" x2="15" y1="4" y2="20" />
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

function formatEditedAgo(value?: string) {
  if (!value) {
    return "Editado agora";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Editado agora";
  }

  const diffMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (diffMinutes < 1) {
    return "Editado agora";
  }
  if (diffMinutes < 60) {
    return `Editado há ${diffMinutes} min`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `Editado há ${diffHours} h`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `Editado há ${diffDays} d`;
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

// Wrapper generico (rotulo + conteudo) para os campos da coluna de Detalhes.
// Definido aqui (Parte 2) mas so ganha uso real na Parte 3, quando os campos
// de Colecao/Tags/PDFs vinculados/Descricao forem implementados de verdade.
function NotebookInfoField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <p className="text-xs font-bold text-text-secondary">{label}</p>
      <div className="mt-2">{children}</div>
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
  const [pageSearchTerm, setPageSearchTerm] = useState("");
  const pageContextMenu = useContextMenu();
  const [draftTitle, setDraftTitle] = useState("");
  const [editorStats, setEditorStats] = useState<EditorStats>({ words: 0, characters: 0 });
  const [editorZoomPercent, setEditorZoomPercent] = useState(100);
  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [saveStatus, setSaveStatus] = useState<NotebookSaveStatus>("saved");
  const [isStatsDialogOpen, setIsStatsDialogOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [exportScope, setExportScope] = useState<NotebookExportScope>("full-notebook");
  const [isPreparingExport, setIsPreparingExport] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [preparedExport, setPreparedExport] = useState<NotebookExportPreparation | null>(null);
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

  // Coluna de Paginas (esquerda): sempre visivel por padrao. Diferente da de
  // Detalhes, ela NUNCA colapsa sozinha pelo breakpoint (tem prioridade de
  // navegacao) — so o toggle manual do usuario a esconde/mostra.
  const [isPagesPanelOpen, setIsPagesPanelOpen] = useState(true);

  // Coluna de Detalhes (Parte 3): visivel por padrao, mas escondida atras do
  // botao de toggle do header quando o painel comeca (ou e redimensionado)
  // abaixo do breakpoint — a coluna de paginas tem prioridade sobre a de
  // Detalhes, entao e sempre ela que cede espaco primeiro.
  const [isDetailsPanelOpen, setIsDetailsPanelOpen] = useState(() => getInitialPanelSize().width >= notebookDetailsCollapseBreakpoint);
  const wasNarrowRef = useRef(getInitialPanelSize().width < notebookDetailsCollapseBreakpoint);

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
  const notebookOptionsContextMenu = useContextMenu();
  const detailsColumnRef = useRef<HTMLElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const notebookTagDropdownRef = useRef<HTMLDivElement | null>(null);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);

  // Rascunho corrente fora do estado React: o conteudo muda a cada tecla e
  // re-renderizar o painel inteiro por tecla seria desperdicio — o autosave
  // le os refs no momento do save.
  const activePageIdRef = useRef<number | null>(null);
  const draftTitleRef = useRef("");
  const draftContentRef = useRef("");
  const isDirtyRef = useRef(false);
  const saveQueueTailRef = useRef<Promise<void>>(Promise.resolve());
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
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
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

  async function prepareNotebookExport() {
    setExportError(null);
    setPreparedExport(null);
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
      const build = buildNotebookExportHtml({
        notebookId,
        notebookTitle: exportTitle,
        scope: exportScope,
        pages: selectedPages,
      });

      setPreparedExport({
        notebookId,
        scope: exportScope,
        pageIds,
        destinationPath,
        build,
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
      const result = await writeNotebookExport({
        destinationPath: preparedExport.destinationPath,
        html: preparedExport.build.html,
        manifest: preparedExport.build.manifest,
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
    setIsZoomMenuOpen(false);
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

  // Auto-esconde a coluna de Detalhes so na TRANSICAO para largura estreita
  // (nunca forca reabrir sozinho — se o usuario reabriu manualmente via
  // toggle e depois alargar/estreitar de novo, a escolha dele fica de pe).
  useEffect(() => {
    const isNarrow = panelSize.width < notebookDetailsCollapseBreakpoint;

    if (isNarrow && !wasNarrowRef.current) {
      setIsDetailsPanelOpen(false);
    }

    wasNarrowRef.current = isNarrow;
  }, [panelSize.width]);

  // Esc fecha o painel — mas so quando ele e o TOPO da pilha, para nao fechar
  // varios paineis com um unico Esc.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      const topPanel = panels[panels.length - 1];
      if (topPanel?.id === panel.id) {
        if (isFocusMode) {
          event.preventDefault();
          exitFocusMode();
          return;
        }

        void handleClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panels, panel.id, handleClose, isFocusMode, exitFocusMode]);

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
    if (!isZoomMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (event.target instanceof Node && zoomMenuRef.current && !zoomMenuRef.current.contains(event.target)) {
        setIsZoomMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isZoomMenuOpen]);

  const activePage = pages.find((page) => page.id === activePageId) ?? null;
  const exportCurrentPageTitle = activePage ? pageDisplayTitle(activePage) : "Página atual";
  const exportPreparedScopeLabel =
    preparedExport?.scope === "current-page" ? "Página atual" : preparedExport?.scope === "full-notebook" ? "Caderno completo" : "";

  const visiblePages = useMemo(() => {
    const term = pageSearchTerm.trim().toLowerCase();
    if (!term) {
      return pages;
    }
    return pages.filter((page) => pageDisplayTitle(page).toLowerCase().includes(term));
  }, [pages, pageSearchTerm]);
  const currentCollectionName = collections.find((collection) => collection.id === infoDraftCollectionId)?.name ?? notebookInfo?.collectionName ?? "Sem título";
  const notebookSummary = `${pages.length} ${pages.length === 1 ? "página" : "páginas"} - ${formatEditedAgo(notebookInfo?.updatedAt)}`;
  const saveStatusText = getNotebookSaveStatusLabel(saveStatus);
  const readingStatusPercent = getReadingStatusPercent(infoDraftReadingStatus);
  const editorZoomScale = editorZoomPercent / 100;
  const activeSpacingMode = isFocusMode ? focusSpacingMode : normalSpacingMode;
  const activeContentInset = isFocusMode ? focusContentInset : contentInset;
  const shouldShowPagesPanel = isPagesPanelOpen && !isFocusMode;
  const shouldShowDetailsPanel = isDetailsPanelOpen && !isFocusMode;
  const pagesColumnWidth = shouldShowPagesPanel ? notebookPagesColumnWidth : 0;
  const canRenderDetailsInline = panelSize.width >= pagesColumnWidth + notebookDetailsColumnWidth + notebookEditorMinWidth;
  const shouldRenderDetailsAsDrawer = shouldShowDetailsPanel && !canRenderDetailsInline;
  const zoomControl = (
    <div className="relative" ref={zoomMenuRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isZoomMenuOpen}
        title="Zoom do editor"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
        onClick={() => setIsZoomMenuOpen((current) => !current)}
      >
        {editorZoomPercent}%
        <ChevronDownIcon />
      </button>

      {isZoomMenuOpen ? (
        <div className="absolute bottom-full right-0 z-30 mb-2 min-w-24 rounded-lg border border-border-subtle bg-surface-panel p-1 shadow-lg">
          {editorZoomOptions.map((zoomOption) => (
            <button
              key={zoomOption}
              type="button"
              role="menuitemradio"
              aria-checked={editorZoomPercent === zoomOption}
              className={`block w-full rounded-md px-3 py-1.5 text-left text-xs font-semibold transition ${
                editorZoomPercent === zoomOption
                  ? "bg-primary-soft text-primary"
                  : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
              }`}
              onClick={() => {
                setEditorZoomPercent(zoomOption);
                setIsZoomMenuOpen(false);
              }}
            >
              {zoomOption}%
            </button>
          ))}
        </div>
      ) : null}
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
          className={`grid h-10 shrink-0 grid-cols-[minmax(120px,1fr)_minmax(0,1.4fr)_minmax(160px,1fr)] items-center border-b border-[var(--floating-header-border)] bg-[var(--floating-header-bg)] px-4 ${
            isMaximized ? "" : "cursor-move"
          }`}
          onMouseDown={isMaximized ? undefined : startDragging}
        >
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              aria-label={isPagesPanelOpen ? "Fechar lista de páginas" : "Lista de páginas"}
              title={isPagesPanelOpen ? "Fechar lista de páginas" : "Lista de páginas"}
              aria-pressed={shouldShowPagesPanel}
              className={`shrink-0 rounded-md p-1.5 transition hover:bg-[var(--floating-header-hover-bg)] ${
                shouldShowPagesPanel ? "text-[var(--floating-header-text)]" : "text-[var(--floating-header-control)]"
              }`}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                if (isFocusMode) {
                  exitFocusMode();
                  return;
                }
                setIsPagesPanelOpen((current) => !current);
              }}
            >
              <PagesToggleIcon />
            </button>
          </div>
          <nav
            aria-label="Localização do caderno"
            className="flex min-w-0 items-center justify-center gap-2 text-xs font-semibold text-[var(--floating-header-muted)]"
          >
            <span className="truncate">Minha Biblioteca</span>
            <BreadcrumbChevronIcon />
            <span className="truncate">{currentCollectionName}</span>
            <BreadcrumbChevronIcon />
            <span className="truncate font-bold text-[var(--floating-header-text)]">{notebookTitle || "Caderno"}</span>
          </nav>
          <div className="flex items-center justify-end gap-1" onMouseDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              aria-label={isDetailsPanelOpen ? "Fechar informações do caderno" : "Informações do caderno"}
              title={isDetailsPanelOpen ? "Fechar informações do caderno" : "Informações do caderno"}
              aria-pressed={shouldShowDetailsPanel}
              className={`rounded-md p-1.5 transition hover:bg-[var(--floating-header-hover-bg)] ${
                shouldShowDetailsPanel ? "text-[var(--floating-header-text)]" : "text-[var(--floating-header-control)]"
              }`}
              onClick={() => {
                if (isFocusMode) {
                  exitFocusMode();
                  return;
                }
                setIsDetailsPanelOpen((current) => !current);
              }}
            >
              <DetailsToggleIcon />
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
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--card)]">
          {/* ================= COLUNA 1: PAGINAS ================= */}
          {shouldShowPagesPanel ? (
          <aside
            style={{ width: notebookPagesColumnWidth }}
            className="flex shrink-0 flex-col border-r border-border-subtle bg-surface-card"
          >
            <div className="border-b border-border-subtle p-4">
              <div className="mb-4 flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-10 shrink-0 items-center justify-center rounded-md border border-primary bg-primary-soft text-primary shadow-sm">
                  <NotebookHeaderIcon />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-text-primary" title={notebookTitle || "Caderno"}>
                    {notebookTitle || "Caderno"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-secondary">{notebookSummary}</p>
                </div>
              </div>

              <label className="flex items-center gap-2 rounded-md border border-border-subtle bg-[var(--card)] px-3 py-2 text-text-subtle">
                <SearchIcon />
                <input
                  value={pageSearchTerm}
                  onChange={(event) => setPageSearchTerm(event.target.value)}
                  placeholder="Buscar páginas..."
                  aria-label="Buscar páginas"
                  className="min-w-0 flex-1 border-0 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-subtle"
                />
              </label>

              <button
                type="button"
                onClick={() => void addPage()}
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-bold text-text-inverse shadow-sm transition hover:bg-primary-dark"
              >
                <PlusIcon />
                Nova página
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">
              <div className="px-1 pb-2 pt-5">
                <SectionLabel>Páginas</SectionLabel>
              </div>

              <ul className="flex flex-col gap-1">
                {visiblePages.map((page) => (
                  <li
                    key={page.id}
                    onContextMenu={(event) => {
                      event.stopPropagation();
                      setContextPageId(page.id);
                      pageContextMenu.open(event);
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => void switchToPage(page.id)}
                      aria-current={page.id === activePageId}
                      title={pageDisplayTitle(page)}
                      className={`block w-full truncate rounded-md px-3 py-2 text-left text-sm transition ${
                        page.id === activePageId
                          ? "border-l-2 border-primary bg-primary-soft font-semibold text-primary"
                          : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
                      }`}
                    >
                      {pageDisplayTitle(page)}
                    </button>
                  </li>
                ))}
              </ul>

              {/* Secoes reais (agrupar paginas) ficam para uma proxima rodada —
                  por ora a lista e sempre plana. O link fica visivel (mesmo
                  visual da referencia) mas desabilitado, para nao fingir uma
                  funcionalidade que ainda nao existe. */}
              <button
                type="button"
                disabled
                title="Em breve"
                className="mt-2 inline-flex w-fit items-center gap-1.5 px-1 text-xs font-medium text-text-subtle opacity-60"
              >
                <PlusIcon size={11} />
                Adicionar seção
              </button>
            </div>
          </aside>
          ) : null}

          {/* ================= COLUNA 2: EDITOR ================= */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className={`flex shrink-0 items-start ${activeContentInset}`}>
              <input
                value={draftTitle}
                onChange={(event) => {
                  setDraftTitle(event.target.value);
                  draftTitleRef.current = event.target.value;
                  isDirtyRef.current = true;
                  setSaveStatus("dirty");
                }}
                onBlur={() => void saveActivePage()}
                placeholder={`Página sem título ${activePage.position}`}
                aria-label="Título da página"
                style={{ fontSize: `${28 * editorZoomScale}px` }}
                className="min-w-0 flex-1 border-0 bg-transparent pb-2 pr-5 pt-7 font-serif text-[28px] font-medium leading-tight text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              />
              {!isFocusMode ? (
                <span className="mt-8 hidden shrink-0 items-center gap-1 text-xs font-medium text-text-subtle md:inline-flex">
                  {saveStatusText}
                  {saveStatus === "saved" ? <SavedIcon /> : null}
                </span>
              ) : null}
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
              }}
              onBlur={() => void saveActivePage()}
            />

            <div className="flex h-9 shrink-0 items-center justify-between border-t border-border-subtle bg-[var(--card)] px-4 text-xs text-text-secondary">
              {isFocusMode ? (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex items-center gap-1">
                      {saveStatusText}
                      {saveStatus === "saved" ? <SavedIcon /> : null}
                    </span>
                    <span className="text-text-subtle" aria-hidden="true">·</span>
                    <span>{formatCount(editorStats.words)} palavras</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button
                      type="button"
                      className="inline-flex items-center rounded-md px-2 py-1 font-medium text-primary transition hover:bg-primary-soft"
                      onClick={exitFocusMode}
                    >
                      Sair do foco · Esc
                    </button>
                    <span className="h-4 w-px bg-border-subtle" aria-hidden="true" />
                    {zoomControl}
                  </div>
                </>
              ) : (
                <>
              <div className="flex min-w-0 items-center gap-4">
                <span>{formatCount(editorStats.words)} palavras</span>
                <span>{formatCount(editorStats.characters)} caracteres</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  onClick={enterFocusMode}
                  title="Entrar no modo foco"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                >
                  <FocusModeIcon />
                  Foco
                </button>
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
              style={{ width: notebookDetailsColumnWidth, maxWidth: shouldRenderDetailsAsDrawer ? "calc(100% - 3rem)" : undefined }}
              className={`flex flex-col overflow-hidden border-l border-border-subtle bg-[var(--card)] ${
                shouldRenderDetailsAsDrawer ? "absolute bottom-0 right-0 top-0 z-30 shadow-2xl" : "shrink-0"
              }`}
            >
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <SectionLabel>Detalhes</SectionLabel>
                <button
                  type="button"
                  aria-label="Mais opções"
                  title="Mais opções"
                  aria-haspopup="menu"
                  aria-expanded={notebookOptionsContextMenu.isOpen}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
                  onClick={(event) => openNotebookOptionsMenu(event, "header")}
                >
                  <MoreVerticalIcon />
                </button>
              </div>

              <NotebookInfoField label="Caderno">
                <input
                  ref={titleInputRef}
                  value={infoDraftTitle}
                  onChange={(event) => {
                    setInfoDraftTitle(event.target.value);
                    infoDraftTitleRef.current = event.target.value;
                    isInfoDirtyRef.current = true;
                    setSaveStatus("dirty");
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

              <NotebookInfoField label="Tags">
                <div className="relative" ref={notebookTagDropdownRef}>
                  <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    {notebookTags.map((tag) => (
                      <span key={tag} className="group relative inline-flex min-w-0 max-w-full">
                        <button type="button" className="min-w-0 max-w-full rounded-full text-left" title={tag}>
                          <TagBadge tag={tag} size="compact" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remover tag ${tag}`}
                          title={`Remover tag ${tag}`}
                          className="absolute -right-1.5 -top-1.5 hidden h-[14px] w-[14px] items-center justify-center rounded-full bg-status-red text-[10px] font-bold leading-none text-status-red-text shadow-sm group-hover:flex"
                          onClick={() => void handleTagsChange(notebookTags.filter((currentTag) => currentTag !== tag))}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </span>
                    ))}

                    <button
                      type="button"
                      className="inline-flex items-center rounded-full border border-dashed border-[#D6C8BB] bg-[#E8DDD4] px-2 py-0.5 text-[11px] font-medium text-text-secondary transition hover:brightness-95 dark:border-[#4A3A2F] dark:bg-[#332820]"
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

              <NotebookInfoField label="PDFs vinculados">
                {linkedDocuments.length === 0 ? (
                  <p className="text-sm text-text-secondary">Nenhum PDF vinculado</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {linkedDocuments.map((document) => (
                      <li
                        key={document.id}
                        className="group flex items-start gap-2 rounded-md border border-border-subtle bg-surface-card px-3 py-2"
                      >
                        <span className="mt-0.5 shrink-0 rounded-md bg-status-red px-1.5 py-1 text-text-inverse">
                          <PdfIcon />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-text-primary" title={document.title}>
                            {document.title}
                          </p>
                          <p className="truncate text-xs text-text-secondary">
                            {document.authors.length > 0 ? document.authors.join(", ") : "Sem autor"} - {document.year}
                          </p>
                        </div>
                        <button
                          type="button"
                          aria-label={`Desvincular ${document.title}`}
                          title="Desvincular"
                          className="shrink-0 rounded-md p-1 text-text-subtle opacity-0 transition hover:bg-surface-muted hover:text-status-red-text group-hover:opacity-100"
                          onClick={() => void handleUnlinkDocument(document.id)}
                        >
                          <CloseIcon />
                        </button>
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

              <NotebookInfoField label="Reading Status">
                <div className="rounded-md border border-border-subtle bg-[var(--card)] p-2">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-text-secondary">
                      <OpenBookIcon />
                    </span>
                    <div className="relative min-w-0 flex-1">
                      <select
                        value={infoDraftReadingStatus}
                        onChange={(event) => {
                          const nextStatus = event.target.value as NotebookReadingStatus;
                          setInfoDraftReadingStatus(nextStatus);
                          infoDraftReadingStatusRef.current = nextStatus;
                          isInfoDirtyRef.current = true;
                          setSaveStatus("dirty");
                          void saveNotebookInfoDraft();
                        }}
                        className="w-full appearance-none border-0 bg-transparent py-1 pr-6 text-sm font-medium text-text-primary outline-none"
                      >
                        {notebookReadingStatusOptions.map((option) => (
                          <option key={option.value} value={option.value} className={notebookSelectOptionClassName} style={notebookSelectOptionStyle}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-text-subtle">
                        <ChevronDownIcon />
                      </span>
                    </div>
                    <span className="shrink-0 rounded-md bg-surface-app px-2 py-1 text-xs font-semibold text-text-secondary">
                      {readingStatusPercent}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-sm bg-surface-app">
                    <div className="h-full rounded-sm bg-primary" style={{ width: `${readingStatusPercent}%` }} />
                  </div>
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
                  }}
                  onBlur={() => void saveNotebookInfoDraft()}
                  placeholder="Descreva seu caderno..."
                  className="h-24 w-full resize-y rounded-md border border-border-subtle bg-surface-app px-3 py-3 text-sm font-normal text-text-primary outline-none placeholder:text-text-subtle focus:border-primary"
                />
              </NotebookInfoField>

              <NotebookInfoField label="Autor / disciplina">
                <input
                  value={infoDraftAuthorDiscipline}
                  onChange={(event) => {
                    setInfoDraftAuthorDiscipline(event.target.value);
                    infoDraftAuthorDisciplineRef.current = event.target.value;
                    isInfoDirtyRef.current = true;
                    setSaveStatus("dirty");
                  }}
                  onBlur={() => void saveNotebookInfoDraft()}
                  placeholder="Autor ou disciplina..."
                  className="h-10 w-full rounded-md border border-border-subtle bg-[var(--card)] px-3 text-sm font-medium text-text-primary outline-none placeholder:text-text-subtle focus:border-primary"
                />
              </NotebookInfoField>

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
                  <div className="grid grid-cols-[1fr_auto] gap-3">
                    <dt className="font-bold text-text-secondary">Última abertura</dt>
                    <dd className="text-right font-medium text-text-primary">{formatNotebookDate(openedAt)}</dd>
                  </div>
                </dl>
              </div>

              </div>

              <footer className="shrink-0 border-t border-border-subtle bg-[var(--card)] px-5 py-4">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={notebookOptionsContextMenu.isOpen}
                  className="grid w-full grid-cols-[16px_1fr_16px] items-center gap-2 rounded-md border border-border-subtle bg-[var(--card)] px-3 py-2 text-xs font-semibold text-text-secondary transition hover:border-primary hover:text-text-primary"
                  onClick={(event) => openNotebookOptionsMenu(event, "footer")}
                >
                  <span aria-hidden="true" />
                  <span>Mais opções</span>
                  <MoreVerticalIcon />
                </button>
              </footer>

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
                <ContextMenuItem icon={<MenuGlyph name="print" />} label="Imprimir" onSelect={() => undefined} disabled />
                <ContextMenuItem icon={<MenuGlyph name="link" />} label="Copiar link interno" onSelect={() => undefined} disabled />
                <ContextMenuDivider />
                <ContextMenuItem icon={<MenuGlyph name="history" />} label="Histórico de alterações" onSelect={() => undefined} disabled />
                <ContextMenuItem icon={<MenuGlyph name="stats" />} label="Contagem detalhada" onSelect={openDetailedCount} />
                <ContextMenuDivider />
                <ContextMenuItem icon={<TrashIcon size={16} />} label="Mover para a lixeira" variant="danger" onSelect={() => void moveNotebookToTrashFromOptions()} />
              </ContextMenu>
            </aside>
          ) : null}
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
                    Manifest: {formatCount(preparedExport.build.manifest.slots.length)}{" "}
                    {preparedExport.build.manifest.slots.length === 1 ? "sentinela" : "sentinelas"}
                    {preparedExport.build.warnings.length > 0 ? ` - ${formatCount(preparedExport.build.warnings.length)} avisos` : ""}
                  </p>
                  {preparedExport.build.warnings.length > 0 ? (
                    <ul className="grid gap-1 text-xs text-text-secondary">
                      {preparedExport.build.warnings.map((warning, index) => (
                        <li key={`${warning.code}-${warning.pageId}-${index}`} className="break-words [overflow-wrap:anywhere]">
                          {formatNotebookExportBuildWarning(warning)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="break-words text-xs font-medium text-text-primary [overflow-wrap:anywhere] [word-break:break-word]" title={preparedExport.destinationPath}>
                    {preparedExport.destinationPath}
                  </p>
                  {!exportResult ? (
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
                  disabled={isPreparingExport || isWritingExport}
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
