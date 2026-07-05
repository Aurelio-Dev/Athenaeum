import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { ContextMenuItem } from "../../components/ui/ContextMenuItem";
import { TrashIcon } from "../../components/ui/SharedIcons";
import { SectionLabel } from "../../components/ui/SectionLabel";
import { TagBadge } from "../../components/TagBadge";
import { TagInput } from "../../components/ui/TagInput";
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
  saveNotebookPage,
  saveNotebookTags,
  setSetting,
  unlinkDocumentFromNotebook,
  updateNotebookInfo,
  type LinkedDocument,
  type NotebookInfo,
  type NotebookReadingStatus,
} from "../../lib/database";
import { useContextMenu } from "../../hooks/useContextMenu";
import type { LibraryCollection, LibraryDocument, NotebookPage, SubjectTag } from "../../types/library";
import { DocumentPickerModal } from "../library/DocumentPickerModal";
import { TagSelector } from "../library/TagSelector";
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

const editorZoomOptions = [75, 90, 100, 110, 125, 150] as const;

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
  // Avisa a listagem (contagem de paginas / "Editado ha X") apos cada save.
  onNotebookChanged: () => void;
};

export function NotebookPanel({ panel, collections, documents, availableTags, onAvailableTagsChange, onClose, onNotebookChanged }: NotebookPanelProps) {
  const notebookId = Number(panel.entityId);
  const { panels, movePanel } = useFloatingPanels();

  const [notebookTitle, setNotebookTitle] = useState("");
  const [pages, setPages] = useState<NotebookPage[]>([]);
  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [contextPageId, setContextPageId] = useState<number | null>(null);
  const [panelSize, setPanelSize] = useState(getInitialPanelSize);
  const [isMaximized, setIsMaximized] = useState(false);
  const [pageSearchTerm, setPageSearchTerm] = useState("");
  const pageContextMenu = useContextMenu();
  const [draftTitle, setDraftTitle] = useState("");
  const [editorStats, setEditorStats] = useState<EditorStats>({ words: 0, characters: 0 });
  const [editorZoomPercent, setEditorZoomPercent] = useState(100);
  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState(false);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [normalSpacingMode, setNormalSpacingMode] = useState<NotebookSpacingMode>("normal");
  const [focusSpacingMode, setFocusSpacingMode] = useState<NotebookSpacingMode>("comfortable");
  const [openedAt] = useState(() => new Date().toISOString());
  const restoreStateRef = useRef<{
    position: { x: number; y: number };
    size: { width: number; height: number };
    collapsed: boolean;
  } | null>(null);

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

  // Tags do caderno + PDFs vinculados (colunas de Detalhes). O boundaryRef e a
  // propria coluna: o dropdown do TagInput so fecha ao clicar FORA dela (rolar
  // dentro nao fecha).
  const [notebookTags, setNotebookTags] = useState<SubjectTag[]>([]);
  const [linkedDocuments, setLinkedDocuments] = useState<LinkedDocument[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);
  const detailsColumnRef = useRef<HTMLElement | null>(null);
  const notebookTagDropdownRef = useRef<HTMLDivElement | null>(null);
  const zoomMenuRef = useRef<HTMLDivElement | null>(null);

  // Rascunho corrente fora do estado React: o conteudo muda a cada tecla e
  // re-renderizar o painel inteiro por tecla seria desperdicio — o autosave
  // le os refs no momento do save.
  const activePageIdRef = useRef<number | null>(null);
  const draftTitleRef = useRef("");
  const draftContentRef = useRef("");
  const isDirtyRef = useRef(false);
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

  const saveActivePage = useCallback(async () => {
    const pageId = activePageIdRef.current;

    if (!isDirtyRef.current || pageId === null) {
      return;
    }

    // Le os rascunhos SINCRONAMENTE antes de qualquer await: trocas de pagina
    // que acontecam durante o save nao contaminam o payload.
    const trimmedTitle = draftTitleRef.current.trim();
    const title = trimmedTitle.length > 0 ? trimmedTitle : null;
    const content = draftContentRef.current;
    isDirtyRef.current = false;

    try {
      await saveNotebookPage(pageId, { title, content });
      setPages((currentPages) => currentPages.map((page) => (page.id === pageId ? { ...page, title, content } : page)));
      setNotebookInfo((currentInfo) => (currentInfo ? { ...currentInfo, updatedAt: new Date().toISOString() } : currentInfo));
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel salvar a pagina do caderno.", error);
      isDirtyRef.current = true;
    }
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
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel salvar as informacoes do caderno.", error);
      isInfoDirtyRef.current = true;
    }
  }, [collections, notebookId, notebookInfo?.collectionId]);

  const handleTagsChange = useCallback(
    async (nextTags: SubjectTag[]) => {
      setNotebookTags(nextTags); // otimista: a UI reflete na hora
      try {
        await saveNotebookTags(notebookId, nextTags);
      } catch (error) {
        console.warn("Nao foi possivel salvar as tags do caderno.", error);
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

      try {
        await linkDocumentToNotebook(notebookId, documentId);
      } catch (error) {
        console.warn("Nao foi possivel vincular o documento.", error);
        setLinkedDocuments((current) => current.filter((document) => document.id !== documentId));
      }
    },
    [documents, linkedDocuments, notebookId],
  );

  const handleUnlinkDocument = useCallback(
    async (documentId: string) => {
      setLinkedDocuments((current) => current.filter((document) => document.id !== documentId));

      try {
        await unlinkDocumentFromNotebook(notebookId, documentId);
      } catch (error) {
        console.warn("Nao foi possivel desvincular o documento.", error);
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
      const page = await createNotebookPage(notebookId);
      setPages((currentPages) => [...currentPages, page]);
      setNotebookInfo((currentInfo) => (currentInfo ? { ...currentInfo, updatedAt: page.createdAt } : currentInfo));
      setActivePageDrafts(page);
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel criar a pagina.", error);
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
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel excluir a pagina do caderno.", error);
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
    if (!isMaximized) {
      return;
    }

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

  const visiblePages = useMemo(() => {
    const term = pageSearchTerm.trim().toLowerCase();
    if (!term) {
      return pages;
    }
    return pages.filter((page) => pageDisplayTitle(page).toLowerCase().includes(term));
  }, [pages, pageSearchTerm]);
  const currentCollectionName = collections.find((collection) => collection.id === infoDraftCollectionId)?.name ?? notebookInfo?.collectionName ?? "Sem título";
  const notebookSummary = `${pages.length} ${pages.length === 1 ? "página" : "páginas"} - ${formatEditedAgo(notebookInfo?.updatedAt)}`;
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
                }}
                onBlur={() => void saveActivePage()}
                placeholder={`Página sem título ${activePage.position}`}
                aria-label="Título da página"
                style={{ fontSize: `${28 * editorZoomScale}px` }}
                className="min-w-0 flex-1 border-0 bg-transparent pb-2 pr-5 pt-7 font-serif text-[28px] font-medium leading-tight text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              />
              {!isFocusMode ? (
                <span className="mt-8 hidden shrink-0 items-center gap-1 text-xs font-medium text-text-subtle md:inline-flex">
                  Salvo agora
                  <SavedIcon />
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
              }}
              onBlur={() => void saveActivePage()}
            />

            <div className="flex h-9 shrink-0 items-center justify-between border-t border-border-subtle bg-[var(--card)] px-4 text-xs text-text-secondary">
              {isFocusMode ? (
                <>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex items-center gap-1">
                      Salvo agora
                      <SavedIcon />
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
              className={`flex flex-col overflow-y-auto border-l border-border-subtle bg-[var(--card)] px-5 py-5 ${
                shouldRenderDetailsAsDrawer ? "absolute bottom-0 right-0 top-0 z-30 shadow-2xl" : "shrink-0"
              }`}
            >
              <SectionLabel>Detalhes</SectionLabel>

              <NotebookInfoField label="Caderno">
                <input
                  value={infoDraftTitle}
                  onChange={(event) => {
                    setInfoDraftTitle(event.target.value);
                    infoDraftTitleRef.current = event.target.value;
                    isInfoDirtyRef.current = true;
                  }}
                  onBlur={() => void saveNotebookInfoDraft()}
                  placeholder="Caderno sem título"
                  className="h-10 w-full rounded-md border border-border-subtle bg-[var(--card)] px-3 text-sm font-medium text-text-primary outline-none focus:border-primary"
                />
              </NotebookInfoField>

              <NotebookInfoField label="Coleção">
                <select
                  value={infoDraftCollectionId}
                  onChange={(event) => {
                    setInfoDraftCollectionId(event.target.value);
                    infoDraftCollectionIdRef.current = event.target.value;
                    isInfoDirtyRef.current = true;
                    void saveNotebookInfoDraft();
                  }}
                  className="min-h-10 w-full appearance-none rounded-md border border-border-subtle bg-[var(--card)] px-3 py-2.5 text-sm font-medium text-text-primary outline-none focus:border-primary"
                >
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              </NotebookInfoField>

              <NotebookInfoField label="Status de leitura">
                <select
                  value={infoDraftReadingStatus}
                  onChange={(event) => {
                    const nextStatus = event.target.value as NotebookReadingStatus;
                    setInfoDraftReadingStatus(nextStatus);
                    infoDraftReadingStatusRef.current = nextStatus;
                    isInfoDirtyRef.current = true;
                    void saveNotebookInfoDraft();
                  }}
                  className="min-h-10 w-full appearance-none rounded-md border border-border-subtle bg-[var(--card)] px-3 py-2.5 text-sm font-medium text-text-primary outline-none focus:border-primary"
                >
                  {notebookReadingStatusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
                  <PlusIcon size={12} />
                  Vincular PDF
                </button>
              </NotebookInfoField>

              <NotebookInfoField label="Tags">
                <div className="relative" ref={notebookTagDropdownRef}>
                  <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
                    {notebookTags.map((tag) => (
                      <span key={tag} className="group relative inline-flex min-w-0 max-w-full">
                        <button type="button" className="min-w-0 max-w-full rounded-full text-left" title={tag}>
                          <TagBadge tag={tag} />
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
                      className="inline-flex items-center rounded-full border border-border-subtle px-2.5 py-1 text-xs font-medium text-text-secondary transition hover:bg-surface-muted"
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

              <NotebookInfoField label="Autor / disciplina">
                <input
                  value={infoDraftAuthorDiscipline}
                  onChange={(event) => {
                    setInfoDraftAuthorDiscipline(event.target.value);
                    infoDraftAuthorDisciplineRef.current = event.target.value;
                    isInfoDirtyRef.current = true;
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

              <div className="hidden" aria-hidden="true">

              {/* 1. Titulo */}
              <label className="mt-5 block text-xs font-bold text-text-secondary">
                Título
                <input
                  value={infoDraftTitle}
                  onChange={(event) => {
                    setInfoDraftTitle(event.target.value);
                    infoDraftTitleRef.current = event.target.value;
                    isInfoDirtyRef.current = true;
                  }}
                  onBlur={() => void saveNotebookInfoDraft()}
                  placeholder="Caderno sem título"
                  className="mt-2 h-10 w-full rounded-lg border border-border-subtle bg-transparent px-3 text-sm font-medium text-text-primary outline-none focus:border-primary"
                />
              </label>

              {/* 2. Colecao */}
              <div className="mt-5 text-xs font-bold text-text-secondary">
                Coleção
                <select
                  value={infoDraftCollectionId}
                  onChange={(event) => {
                    setInfoDraftCollectionId(event.target.value);
                    infoDraftCollectionIdRef.current = event.target.value;
                    isInfoDirtyRef.current = true;
                    void saveNotebookInfoDraft();
                  }}
                  className="mt-2 min-h-10 w-full appearance-none rounded-full border-0 bg-primary-soft px-4 py-2.5 text-sm font-medium text-text-primary outline-none"
                >
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* 3. Tags — TagInput compartilhado (mesmo vocabulario dos documentos) */}
              <NotebookInfoField label="Tags">
                <TagInput
                  availableTags={availableTags}
                  selectedTags={notebookTags}
                  onSelectedTagsChange={(tags) => void handleTagsChange(tags)}
                  onAvailableTagsChange={onAvailableTagsChange}
                  boundaryRef={detailsColumnRef}
                  placeholder="Adicionar tag..."
                />
              </NotebookInfoField>

              {/* 4. PDFs vinculados */}
              <NotebookInfoField label="PDFs vinculados">
                {linkedDocuments.length === 0 ? (
                  <p className="text-sm text-text-secondary">Nenhum PDF vinculado</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {linkedDocuments.map((document) => (
                      <li
                        key={document.id}
                        className="group flex items-start gap-2 rounded-lg border border-border-subtle bg-surface-card px-3 py-2"
                      >
                        <span className="mt-0.5 shrink-0 text-text-subtle">
                          <PdfIcon />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-text-primary" title={document.title}>
                            {document.title}
                          </p>
                          <p className="truncate text-xs text-text-secondary">
                            {document.authors.length > 0 ? document.authors.join(", ") : "Sem autor"} · {document.year}
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
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-primary transition hover:underline"
                >
                  <PlusIcon size={12} />
                  Vincular PDF
                </button>
              </NotebookInfoField>

              {/* 5. Descricao (generico — ligado a coluna description existente) */}
              <label className="mt-5 block text-xs font-bold text-text-secondary">
                Descrição
                <textarea
                  value={infoDraftDescription}
                  onChange={(event) => {
                    setInfoDraftDescription(event.target.value);
                    infoDraftDescriptionRef.current = event.target.value;
                    isInfoDirtyRef.current = true;
                  }}
                  onBlur={() => void saveNotebookInfoDraft()}
                  placeholder="Descreva seu caderno..."
                  className="mt-2 h-24 w-full resize-y rounded-lg border border-border-subtle bg-transparent px-3 py-3 text-sm font-normal text-text-primary outline-none placeholder:text-text-subtle focus:border-primary"
                />
              </label>

              {/* 6. Metadados read-only: Criado + Atualizado (os DOIS) */}
              <div className="mt-6 border-t border-dashed border-border-subtle pt-2">
                <NotebookInfoField label="Criado em">
                  <span className="text-sm font-medium text-text-primary">
                    {notebookInfo ? formatNotebookDate(notebookInfo.createdAt) : "--"}
                  </span>
                </NotebookInfoField>
                <NotebookInfoField label="Atualizado em">
                  <span className="text-sm font-medium text-text-primary">
                    {notebookInfo ? formatNotebookDate(notebookInfo.updatedAt) : "--"}
                  </span>
                </NotebookInfoField>
              </div>
              </div>
            </aside>
          ) : null}
        </div>
      )}

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
