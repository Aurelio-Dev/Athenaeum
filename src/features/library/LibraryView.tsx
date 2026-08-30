import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, SVGProps } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { SettingsPanel, settingsPanelHeight, settingsPanelWidth } from "../settings/SettingsPanel";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
import { EmptyState } from "../../components/EmptyState";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { ContextMenuDivider } from "../../components/ui/ContextMenuDivider";
import { ContextMenuItem } from "../../components/ui/ContextMenuItem";
import {
  countTrashDocuments,
  createCanvas as createPersistedCanvas,
  createCollection as createPersistedCollection,
  createDocument,
  createNotebook as createPersistedNotebook,
  deleteCollection as deletePersistedCollection,
  dismissDocumentFromReadingList,
  emptyTrash,
  getTrashDocumentIds,
  isReaderInvalidationPayload,
  listAvailableTags,
  listCanvases,
  listCollections,
  listLibraryDocuments,
  listNotebooks,
  moveCanvasToCollection as movePersistedCanvasToCollection,
  moveCanvasToTrash as movePersistedCanvasToTrash,
  moveDocumentToTrash,
  moveNotebookToCollection as movePersistedNotebookToCollection,
  moveNotebookToTrash as movePersistedNotebookToTrash,
  permanentlyDeleteDocument,
  READER_PROGRESS_CHANGED_EVENT,
  restoreDocument,
  renameCanvas as renamePersistedCanvas,
  renameCollection as renamePersistedCollection,
  renameNotebook as renamePersistedNotebook,
  setCanvasFavorite,
  setDocumentFavorite,
  setDocumentNote,
  setNotebookFavorite,
  updateCollection as updatePersistedCollection,
  updateDocumentMetadata as updatePersistedDocumentMetadata,
  updateDocumentReadingStatus,
  updateTagTone as updatePersistedTagTone,
} from "../../lib/database";
import type { CollectionUpdates, DocumentMetadataUpdates, ListDocumentsOptions } from "../../lib/database";
import type { Canvas, LibraryCollection, LibraryDocument, LibraryRoute, Notebook, SortMode, SubjectTag, Tone, ViewMode } from "../../types/library";
import { NewCollectionModal } from "../../components/NewCollectionModal";
import { floatingPanelId, getCenteredPanelPosition, useFloatingPanels } from "../../components/floating/FloatingPanelsContext";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useTheme } from "../../hooks/useTheme";
import { CanvasesGrid } from "../canvases/CanvasesGrid";
import { canvasPanelHeight, canvasPanelWidth } from "../canvases/canvasPanelDimensions";
import { NotebooksGrid } from "../notebooks/NotebooksGrid";
import { AddDocumentModal } from "./AddDocumentModal";
import { CollectionTabs, type CollectionTab } from "./CollectionTabs";
import { DocumentCard } from "./DocumentCard";
import { DocumentDetailsPanel } from "./DocumentDetailsPanel";
import { LibraryHeader } from "./LibraryHeader";
import { LibraryToolbar } from "./LibraryToolbar";
import { RenameLibraryItemModal } from "./RenameLibraryItemModal";

// A superficie grafica do Quadro so entra no bundle quando o primeiro painel
// desse tipo for aberto.
const CanvasPanel = lazy(() => import("../canvases/CanvasPanel").then((module) => ({ default: module.CanvasPanel })));

type PendingConfirmation =
  | { type: "permanent-delete"; document: LibraryDocument }
  | { type: "empty-trash" }
  | null;

type RenameTarget =
  | { type: "notebook"; id: number; title: string }
  | { type: "canvas"; id: number; title: string }
  | null;

const allDocumentsOptions: ListDocumentsOptions = {
  searchTerm: "",
  sortMode: "recentes",
  route: { type: "all" },
};

const libraryQueryKeys = {
  all: ["library"] as const,
  collections: () => ["library", "collections"] as const,
  tags: () => ["library", "tags"] as const,
  trashCount: () => ["library", "trashCount"] as const,
  documentsRoot: () => ["library", "documents"] as const,
  documents: ({ searchTerm, sortMode, route }: ListDocumentsOptions) =>
    [
      "library",
      "documents",
      searchTerm,
      sortMode,
      route.type,
      route.type === "collection" ? route.collectionName : "",
    ] as const,
};

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="20.5" x2="16.5" y1="20.5" y2="16.5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <line x1="12" x2="12" y1="5" y2="19" />
      <line x1="5" x2="19" y1="12" y2="12" />
    </svg>
  );
}

function ContextCategoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="14" y="4" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" fill="currentColor" />
      <rect x="14" y="14" width="6" height="6" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function ContextRowsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
      <line x1="5" x2="19" y1="7" y2="7" />
      <line x1="5" x2="19" y1="12" y2="12" />
      <line x1="5" x2="19" y1="17" y2="17" />
    </svg>
  );
}

function ContextGridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </svg>
  );
}

function ContextRefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 0 1-15.1 6.6" />
      <path d="M3 12A9 9 0 0 1 18.1 5.4" />
      <path d="M18 2v4h-4" />
      <path d="M6 22v-4h4" />
    </svg>
  );
}

function isLibraryAreaContextTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return !target.closest(
    "article, button, a, input, textarea, select, [role='button'], [data-context-menu-root='true']",
  );
}

function EmptyLibraryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 60 48" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M30 2 C16 6 4 12 2 16 L2 44 C11 38 22 34 30 32 Z"
        stroke="var(--color-sidebar-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M30 2 C44 6 56 12 58 16 L58 44 C49 38 38 34 30 32 Z"
        stroke="var(--color-sidebar-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptySearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="20" cy="20" r="14" stroke="var(--color-sidebar-muted)" strokeWidth="2" />
      <line x1="30" y1="30" x2="43" y2="43" stroke="var(--color-sidebar-muted)" strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="16" x2="28" y2="16" stroke="var(--color-empty-state-detail)" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="20" x2="24" y2="20" stroke="var(--color-empty-state-detail)" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="24" x2="20" y2="24" stroke="var(--color-empty-state-detail)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function EmptyReadingListIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 52 48" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M13 4.5h26a3.5 3.5 0 0 1 3.5 3.5v34.5H9.5V8A3.5 3.5 0 0 1 13 4.5Z"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M17 15h18" stroke="var(--color-empty-state-detail)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M17 21h13" stroke="var(--color-empty-state-detail)" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M21 42.5V31h10v11.5l-5-3.5-5 3.5Z"
        fill="var(--primary)"
        stroke="var(--primary)"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LibraryView() {
  const queryClient = useQueryClient();
  const { chrome } = useTheme();
  const { panels: floatingPanelsList, openPanel: openFloatingPanel, closePanel: closeFloatingPanel } = useFloatingPanels();
  const [activeRoute, setActiveRoute] = useState<LibraryRoute>({ type: "all" });
  const [searchTerm, setSearchTerm] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recentes");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [collectionTab, setCollectionTab] = useState<CollectionTab>("documents");
  const [isAddPdfModalOpen, setIsAddPdfModalOpen] = useState(false);
  const [isNewCollectionModalOpen, setIsNewCollectionModalOpen] = useState(false);
  const [isEditCollectionModalOpen, setIsEditCollectionModalOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [fileDeletionNotice, setFileDeletionNotice] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const libraryAreaContextMenu = useContextMenu();
  const hasAutoSelectedFirstDocumentRef = useRef(false);

  const isTrashRoute = activeRoute.type === "trash";
  const activeDocumentsOptions = useMemo<ListDocumentsOptions>(
    () => ({ searchTerm, sortMode, route: activeRoute }),
    [activeRoute, searchTerm, sortMode],
  );

  const collectionsQuery = useQuery({
    queryKey: libraryQueryKeys.collections(),
    // Arrow de proposito: passado por referencia, o queryFn receberia o
    // QueryFunctionContext da react-query como `source`.
    queryFn: () => listCollections(),
  });
  const availableTagsQuery = useQuery({
    queryKey: libraryQueryKeys.tags(),
    queryFn: listAvailableTags,
  });
  const trashCountQuery = useQuery({
    queryKey: libraryQueryKeys.trashCount(),
    queryFn: countTrashDocuments,
  });
  const allDocumentsQuery = useQuery({
    queryKey: libraryQueryKeys.documents(allDocumentsOptions),
    queryFn: () => listLibraryDocuments(allDocumentsOptions),
    placeholderData: keepPreviousData,
  });
  const documentsQuery = useQuery({
    queryKey: libraryQueryKeys.documents(activeDocumentsOptions),
    queryFn: () => listLibraryDocuments(activeDocumentsOptions),
    placeholderData: keepPreviousData,
  });

  const collections = collectionsQuery.data ?? [];
  const allDocuments = allDocumentsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const availableTags = availableTagsQuery.data ?? [];
  const trashCount = trashCountQuery.data ?? 0;
  const isLoading =
    collectionsQuery.isPending ||
    availableTagsQuery.isPending ||
    trashCountQuery.isPending ||
    allDocumentsQuery.isPending ||
    documentsQuery.isPending;
  const hasLoadError =
    collectionsQuery.isError ||
    availableTagsQuery.isError ||
    trashCountQuery.isError ||
    allDocumentsQuery.isError ||
    documentsQuery.isError;

  useEffect(() => {
    if (!documentsQuery.data || documentsQuery.isPlaceholderData) {
      return;
    }

    setSelectedDocumentId((currentDocumentId) => {
      if (currentDocumentId && documentsQuery.data.some((document) => document.id === currentDocumentId)) {
        return currentDocumentId;
      }

      if (!hasAutoSelectedFirstDocumentRef.current) {
        hasAutoSelectedFirstDocumentRef.current = true;
        return documentsQuery.data[0]?.id ?? null;
      }

      return null;
    });
  }, [documentsQuery.data, documentsQuery.isPlaceholderData]);

  const invalidateLibraryQueries = useCallback(
    () => queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all }),
    [queryClient],
  );
  const invalidateLibraryDocumentQueries = useCallback(
    () => queryClient.invalidateQueries({ queryKey: libraryQueryKeys.documentsRoot() }),
    [queryClient],
  );

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    void listen<unknown>(READER_PROGRESS_CHANGED_EVENT, (event) => {
      if (!isReaderInvalidationPayload(event.payload) || event.payload.origin === "main") {
        return;
      }

      void invalidateLibraryDocumentQueries();
    })
      .then((removeListener) => {
        if (isDisposed) {
          removeListener();
          return;
        }
        unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Nao foi possivel escutar atualizacoes do Reader na biblioteca.", error);
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [invalidateLibraryDocumentQueries]);

  const updateAvailableTags = useCallback(
    (tags: SubjectTag[]) => {
      queryClient.setQueryData(libraryQueryKeys.tags(), tags);
    },
    [queryClient],
  );

  const updateDocumentInCache = useCallback(
    (documentId: string, updater: (document: LibraryDocument) => LibraryDocument) => {
      queryClient.setQueriesData<LibraryDocument[]>({ queryKey: ["library", "documents"] }, (currentDocuments) =>
        currentDocuments?.map((document) => (document.id === documentId ? updater(document) : document)),
      );
    },
    [queryClient],
  );

  const updateDocumentNotesInCache = useCallback(
    (documentId: string, notes: string) => {
      updateDocumentInCache(documentId, (document) => ({ ...document, notes }));
    },
    [updateDocumentInCache],
  );

  const listClassName =
    viewMode === "list"
      ? "material-surface-elevated divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-surface-card"
      : "grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]";
  const selectedDocument = selectedDocumentId ? documents.find((document) => document.id === selectedDocumentId) ?? null : null;
  const activeCollection =
    activeRoute.type === "collection" ? collections.find((collection) => collection.name === activeRoute.collectionName) : undefined;
  const hasActiveSearch = searchTerm.trim().length > 0;

  // Trocar de rota sempre volta para a aba Documentos — cada colecao abre no
  // seu conteudo principal, e as rotas globais nem tem abas.
  useEffect(() => {
    setCollectionTab("documents");
  }, [activeRoute]);

  const notebooksQuery = useQuery({
    queryKey: ["library", "notebooks", activeCollection?.id ?? ""] as const,
    queryFn: () => listNotebooks(activeCollection?.id ?? ""),
    // So busca quando a aba Cadernos esta visivel numa colecao resolvida.
    enabled: Boolean(activeCollection) && collectionTab === "notebooks",
  });
  const notebooks = notebooksQuery.data ?? [];

  const canvasesQuery = useQuery({
    queryKey: ["library", "canvases", activeCollection?.id ?? ""] as const,
    queryFn: () => listCanvases(activeCollection?.id ?? ""),
    enabled: Boolean(activeCollection) && collectionTab === "canvases",
  });
  const canvases = canvasesQuery.data ?? [];
  const emptyMessage = isTrashRoute ? "Sua lixeira está vazia" : "Nenhum documento encontrado";
  const emptyDescription = isTrashRoute ? "Itens movidos para a lixeira aparecem aqui por até 30 dias." : "Ajuste a busca ou os filtros para ver a biblioteca novamente.";

  async function createNotebookInCollection() {
    if (!activeCollection) {
      return;
    }

    const notebook = await createPersistedNotebook(activeCollection.id);
    await queryClient.invalidateQueries({ queryKey: ["library", "notebooks"] });
    openNotebook(notebook);
  }

  // Caderno abre como janela nativa do SO: open_notebook_window foca a janela
  // existente do mesmo caderno ou cria uma nova (label notebook-<id>).
  function openNotebook(notebook: Notebook) {
    void invoke("open_notebook_window", { notebookId: notebook.id, notebookTitle: notebook.title }).catch((error) => {
      console.warn("Nao foi possivel abrir a janela do Caderno.", error);
    });
  }

  async function toggleNotebookFavorite(notebook: Notebook) {
    await setNotebookFavorite(notebook.id, !notebook.favorite);
    await queryClient.invalidateQueries({ queryKey: ["library", "notebooks"] });
  }

  async function moveNotebookToCollection(notebook: Notebook, collectionId: string) {
    if (notebook.collectionId === collectionId) {
      return;
    }

    await movePersistedNotebookToCollection(notebook.id, collectionId);
    await queryClient.invalidateQueries({ queryKey: ["library", "notebooks"] });
  }

  async function moveNotebookToTrash(notebook: Notebook) {
    await movePersistedNotebookToTrash(notebook.id);
    // Fecha a janela nativa do caderno, se aberta — equivalente ao antigo
    // closeFloatingPanel do painel interno. destroy sem flush e aceitavel
    // aqui: o caderno acabou de ir para a lixeira.
    void invoke("close_notebook_window", { notebookId: notebook.id }).catch(() => undefined);
    await queryClient.invalidateQueries({ queryKey: ["library", "notebooks"] });
    await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.trashCount() });
  }

  async function createCanvasInCollection() {
    if (!activeCollection) {
      return;
    }

    const canvas = await createPersistedCanvas(activeCollection.id);
    await queryClient.invalidateQueries({ queryKey: ["library", "canvases"] });
    // Quadro (900px) abre centralizado — a cascata de canto foi pensada para
    // paineis estreitos e deixava ~metade do painel fora da tela a direita.
    openFloatingPanel("canvas", String(canvas.id), getCenteredPanelPosition(canvasPanelWidth, canvasPanelHeight));
  }

  function openCanvas(canvas: Canvas) {
    openFloatingPanel("canvas", String(canvas.id), getCenteredPanelPosition(canvasPanelWidth, canvasPanelHeight));
  }

  async function toggleCanvasFavorite(canvas: Canvas) {
    await setCanvasFavorite(canvas.id, !canvas.favorite);
    await queryClient.invalidateQueries({ queryKey: ["library", "canvases"] });
  }

  async function moveCanvasToCollection(canvas: Canvas, collectionId: string) {
    if (canvas.collectionId === collectionId) {
      return;
    }

    await movePersistedCanvasToCollection(canvas.id, collectionId);
    await queryClient.invalidateQueries({ queryKey: ["library", "canvases"] });
  }

  async function moveCanvasToTrash(canvas: Canvas) {
    await movePersistedCanvasToTrash(canvas.id);
    closeFloatingPanel(floatingPanelId("canvas", String(canvas.id)));
    await queryClient.invalidateQueries({ queryKey: ["library", "canvases"] });
    await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.trashCount() });
  }

  async function saveDocumentNote(documentId: string, note: string) {
    updateDocumentNotesInCache(documentId, note);
    await setDocumentNote(documentId, note);
  }

  async function updateDocumentMetadata(documentId: string, updates: DocumentMetadataUpdates) {
    await updatePersistedDocumentMetadata(documentId, updates);
    updateAvailableTags(mergeUniqueTags([...availableTags, ...updates.tags]));
    await invalidateLibraryQueries();
  }

  async function updateDocumentTags(documentId: string, tags: SubjectTag[]) {
    const document = allDocuments.find((currentDocument) => currentDocument.id === documentId);

    if (!document) {
      return;
    }

    await updateDocumentMetadata(documentId, {
      title: document.title,
      authors: document.authors,
      source: document.source,
      year: document.year,
      collection: document.collection,
      description: document.description,
      tags,
    });
  }

  async function updateTagTone(tag: SubjectTag, tone: Tone) {
    await updatePersistedTagTone(tag, tone);
    await invalidateLibraryQueries();
  }

  async function toggleFavorite(documentId: string) {
    const document = allDocuments.find((currentDocument) => currentDocument.id === documentId);

    if (!document) {
      return;
    }

    await setDocumentFavorite(documentId, !document.favorite);
    await invalidateLibraryQueries();
  }

  async function toggleReadingCompletion(documentId: string) {
    const targetDocument = allDocuments.find((currentDocument) => currentDocument.id === documentId);

    if (!targetDocument) {
      return;
    }

    const nextStatus =
      targetDocument.status === "completed"
        ? (targetDocument.lastOpenedAt ? "in-progress" : "not-started")
        : "completed";

    await updateDocumentReadingStatus(documentId, nextStatus);
    await invalidateLibraryQueries();
  }

  async function moveToTrash(documentId: string) {
    await moveDocumentToTrash(documentId);
    await invalidateLibraryQueries();
  }

  async function dismissFromReadingList(documentId: string) {
    try {
      await dismissDocumentFromReadingList(documentId);
      await invalidateLibraryQueries();
    } catch (error) {
      console.warn("Nao foi possivel dispensar o documento de Em andamento.", error);
    }
  }

  async function moveDocumentToCollection(documentId: string, collectionId: string) {
    const document = allDocuments.find((currentDocument) => currentDocument.id === documentId);
    const collection = collections.find((currentCollection) => currentCollection.id === collectionId);

    if (!document || !collection || document.collection === collection.name) {
      return;
    }

    await updateDocumentMetadata(documentId, {
      title: document.title,
      authors: document.authors,
      source: document.source,
      year: document.year,
      collection: collection.name,
      description: document.description,
      tags: document.tags,
    });
  }

  async function restoreFromTrash(documentId: string) {
    await restoreDocument(documentId);
    await invalidateLibraryQueries();
  }

  async function addDocument(document: LibraryDocument) {
    await createDocument(document);
    setSelectedDocumentId(document.id);
    await invalidateLibraryQueries();
  }

  async function createCollection(name: string, description: string, color: string) {
    const collection = await createPersistedCollection(name, description, color);
    setActiveRoute({ type: "collection", collectionName: collection.name });
    await invalidateLibraryQueries();
  }

  // Edicao completa (nome/descricao/cor) via lapis no cabecalho da colecao.
  async function editActiveCollection(collection: LibraryCollection, updates: CollectionUpdates) {
    const updatedCollection = await updatePersistedCollection(collection.id, updates);

    if (activeRoute.type === "collection" && activeRoute.collectionName === collection.name) {
      setActiveRoute({ type: "collection", collectionName: updatedCollection.name });
    }

    await invalidateLibraryQueries();
  }

  async function renameCollection(collection: LibraryCollection, name: string) {
    const renamedCollection = await renamePersistedCollection(collection.id, name);
    const nextRoute: LibraryRoute =
      activeRoute.type === "collection" && activeRoute.collectionName === collection.name
        ? { type: "collection", collectionName: renamedCollection.name }
        : activeRoute;

    setActiveRoute(nextRoute);
    await invalidateLibraryQueries();
  }

  async function renameLibraryItem(name: string) {
    if (!renameTarget) {
      return;
    }

    if (renameTarget.type === "notebook") {
      await renamePersistedNotebook(renameTarget.id, name);
      await queryClient.invalidateQueries({ queryKey: ["library", "notebooks"] });
      return;
    }

    await renamePersistedCanvas(renameTarget.id, name);
    await queryClient.invalidateQueries({ queryKey: ["library", "canvases"] });
  }

  async function deleteCollection(collection: LibraryCollection) {
    await deletePersistedCollection(collection.id);

    const nextRoute: LibraryRoute =
      activeRoute.type === "collection" && activeRoute.collectionName === collection.name ? { type: "all" } : activeRoute;

    setActiveRoute(nextRoute);
    await invalidateLibraryQueries();
  }

  async function confirmPendingAction() {
    if (!pendingConfirmation) {
      return;
    }

    setFileDeletionNotice(null);

    if (pendingConfirmation.type === "permanent-delete") {
      const result = await permanentlyDeleteDocument(pendingConfirmation.document.id);
      if (result.outcome === "unmanaged-file-preserved") {
        setFileDeletionNotice(
          `O registro de "${pendingConfirmation.document.title}" foi excluído, mas o arquivo original permaneceu no local escolhido.`,
        );
      }
      setPendingConfirmation(null);
      await invalidateLibraryQueries();
      return;
    }

    const documentIds = await getTrashDocumentIds();
    let preservedFileCount = 0;
    for (const documentId of documentIds) {
      const result = await permanentlyDeleteDocument(documentId);
      if (result.outcome === "unmanaged-file-preserved") {
        preservedFileCount += 1;
      }
    }
    await emptyTrash();
    if (preservedFileCount > 0) {
      setFileDeletionNotice(
        preservedFileCount === 1
          ? "Um registro foi excluído, mas o arquivo original permaneceu no local escolhido."
          : `${preservedFileCount} registros foram excluídos, mas os arquivos originais permaneceram nos locais escolhidos.`,
      );
    }
    setPendingConfirmation(null);
    await invalidateLibraryQueries();
  }

  function openLibraryAreaContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!isLibraryAreaContextTarget(event.target)) {
      return;
    }

    libraryAreaContextMenu.open(event);
  }

  function toggleLibraryViewModeFromContextMenu() {
    setViewMode((currentViewMode) => (currentViewMode === "list" ? "grid" : "list"));
    libraryAreaContextMenu.close();
  }

  function refreshLibraryFromContextMenu() {
    libraryAreaContextMenu.close();
    void invalidateLibraryQueries();
  }

  return (
    <AppShell
      collections={collections}
      documents={allDocuments}
      activeRoute={activeRoute}
      onRouteChange={setActiveRoute}
      onCreateCollection={createCollection}
      onRenameCollection={renameCollection}
      onUpdateCollection={editActiveCollection}
      onDeleteCollection={deleteCollection}
      onEmptyAreaContextMenu={openLibraryAreaContextMenu}
      onOpenSettings={() =>
        openFloatingPanel("settings", "app", getCenteredPanelPosition(settingsPanelWidth, settingsPanelHeight))
      }
    >
      <div className="flex h-full min-h-0 flex-1 flex-col xl:flex-row">
        <div
          className={`material-island min-h-0 min-w-0 flex-1 flex-col ${selectedDocument ? "hidden xl:flex" : "flex"}`}
          onContextMenu={openLibraryAreaContextMenu}
        >
          <div
            data-glass-backdrop={chrome === "docked" ? "optical" : undefined}
            className="material-liquid-bar contents"
          >
            <div className="material-liquid-bar-section flex items-center gap-3 bg-surface-app px-8 pb-5 pt-6">
              <label className="material-liquid-control ml-auto flex w-full max-w-[340px] items-center gap-2 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-text-subtle">
                <SearchIcon />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Pesquisar na biblioteca..."
                  className="min-w-0 flex-1 border-0 bg-transparent text-[12px] leading-[18px] text-text-primary outline-none placeholder:text-text-subtle"
                />
              </label>
              {isTrashRoute ? null : (
                <button
                  type="button"
                  data-glass-backdrop={chrome === "floating" ? "action" : undefined}
                  onClick={() => setIsAddPdfModalOpen(true)}
                  className="material-surface-action inline-flex shrink-0 items-center gap-2 rounded-lg border border-transparent bg-primary px-4 py-2 text-[12px] font-bold leading-[18px] text-primary-foreground shadow-button transition hover:bg-primary-hover"
                >
                  <PlusIcon />
                  Adicionar
                </button>
              )}
            </div>

            {/* Linha horizontal de largura total, logo acima do titulo da colecao
                (diferente do divisor abaixo de "N itens", que e recuado). */}
            <div className="border-t border-border-subtle" />

            <header className="material-liquid-bar-section flex flex-wrap items-end gap-4 bg-surface-app px-8 pb-4 pt-5">
              <LibraryHeader
                title={getRouteTitle(activeRoute)}
                countText={getHeaderCountText(collectionTab, activeRoute, documents.length, notebooks.length, canvases.length)}
                description={activeCollection?.description || undefined}
                tabs={
                  activeRoute.type === "collection" ? (
                    <CollectionTabs activeTab={collectionTab} onTabChange={setCollectionTab} />
                  ) : undefined
                }
                onEdit={activeCollection ? () => setIsEditCollectionModalOpen(true) : undefined}
              />
              {isTrashRoute && trashCount > 0 ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-lg bg-status-red px-4 py-2.5 text-sm font-bold text-status-red-text transition hover:brightness-95"
                  onClick={() => setPendingConfirmation({ type: "empty-trash" })}
                >
                  Esvaziar lixeira
                </button>
              ) : null}
              {activeRoute.type === "collection" && collectionTab !== "documents" ? (
                // Cadernos/Quadros trocam o sort + grid/lista por um "+ Criar"
                // outline terracota, como no design.
                <button
                  type="button"
                  onClick={() => {
                    if (collectionTab === "notebooks") {
                      void createNotebookInCollection();
                    } else {
                      void createCanvasInCollection();
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-primary bg-transparent px-4 py-2 text-[12px] font-bold leading-[18px] text-primary-text transition hover:bg-primary hover:text-primary-foreground"
                >
                  <PlusIcon />
                  Criar
                </button>
              ) : (
                <LibraryToolbar
                  compact={isTrashRoute}
                  chrome={chrome}
                  sortMode={sortMode}
                  viewMode={viewMode}
                  recentSortLabel={activeRoute.type === "reading-list" ? "Aberto recentemente" : "Recente"}
                  onSortModeChange={setSortMode}
                  onViewModeChange={setViewMode}
                />
              )}
            </header>

            {/* Divisor com o mesmo recuo horizontal (px-8) da grade de cards, para
                comecar/terminar alinhado com os cards em vez de atravessar a
                largura toda. mx-8 acompanha o px-8 da secao, entao continua
                alinhado em qualquer largura. */}
            <div className="mx-8 border-t border-border-subtle" />

            {isTrashRoute ? (
              <div className="material-liquid-bar-section border-b border-border-subtle bg-surface-app px-8 py-4 text-sm text-text-secondary">
                Itens na lixeira sao excluidos permanentemente apos 30 dias.
              </div>
            ) : null}
          </div>

          <section className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
            {activeRoute.type === "collection" && collectionTab === "notebooks" ? (
              <NotebooksGrid
                notebooks={notebooks}
                collections={collections}
                isLoading={notebooksQuery.isPending}
                hasError={notebooksQuery.isError}
                onCreate={() => void createNotebookInCollection()}
                onOpen={openNotebook}
                onRename={(notebook) => setRenameTarget({ type: "notebook", id: notebook.id, title: notebook.title })}
                onToggleFavorite={(notebook) => void toggleNotebookFavorite(notebook)}
                onMoveToCollection={(notebook, collectionId) => void moveNotebookToCollection(notebook, collectionId)}
                onMoveToTrash={(notebook) => void moveNotebookToTrash(notebook)}
              />
            ) : activeRoute.type === "collection" && collectionTab === "canvases" ? (
              <CanvasesGrid
                canvases={canvases}
                collections={collections}
                isLoading={canvasesQuery.isPending}
                hasError={canvasesQuery.isError}
                onCreate={() => void createCanvasInCollection()}
                onOpen={openCanvas}
                onRename={(canvas) => setRenameTarget({ type: "canvas", id: canvas.id, title: canvas.title })}
                onToggleFavorite={(canvas) => void toggleCanvasFavorite(canvas)}
                onMoveToCollection={(canvas, collectionId) => void moveCanvasToCollection(canvas, collectionId)}
                onMoveToTrash={(canvas) => void moveCanvasToTrash(canvas)}
              />
            ) : isLoading ? (
              <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
                <div className="rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold text-text-secondary">
                  Carregando biblioteca
                </div>
              </div>
            ) : hasLoadError ? (
              <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
                <div className="rounded-full bg-status-red px-4 py-2 text-sm font-semibold text-status-red-text">
                  Não foi possível carregar a biblioteca.
                </div>
              </div>
            ) : documents.length > 0 ? (
              <div
                data-glass-backdrop={viewMode === "list" ? "optical" : undefined}
                className={listClassName}
              >
                {documents.map((document) => (
                  <DocumentCard
                    key={document.id}
                    activeRoute={activeRoute}
                    document={document}
                    collections={collections}
                    mode={isTrashRoute ? "trash" : "library"}
                    viewMode={viewMode}
                    isSelected={document.id === selectedDocumentId}
                    onSelect={(selectedDocument) => setSelectedDocumentId(selectedDocument.id)}
                    onOpenDetails={(selectedDocument) => setSelectedDocumentId(selectedDocument.id)}
                    onToggleFavorite={(nextDocumentId) => void toggleFavorite(nextDocumentId)}
                    onMoveToCollection={(nextDocumentId, collectionId) => void moveDocumentToCollection(nextDocumentId, collectionId)}
                    onDismissFromReadingList={(nextDocumentId) => void dismissFromReadingList(nextDocumentId)}
                    onDelete={(nextDocumentId) => void moveToTrash(nextDocumentId)}
                  />
                ))}
              </div>
            ) : hasActiveSearch ? (
              <EmptyState
                icon={EmptySearchIcon}
                title="Nenhum resultado encontrado"
                description="Tente outro termo, autor ou palavra-chave."
                verticalPosition="raised"
              />
            ) : activeRoute.type === "reading-list" ? (
              <EmptyState
                icon={EmptyReadingListIcon}
                iconClassName="h-12 w-[52px]"
                title="Nada em andamento"
                titleClassName="text-text-secondary"
                description="Documentos que você abrir aparecem aqui até você marcá-los como concluídos."
                verticalPosition="raised"
              />
            ) : activeRoute.type === "collection" ? (
              <EmptyState
                icon={EmptyLibraryIcon}
                iconClassName="h-12 w-[60px]"
                title="Nenhum documento aqui"
                titleClassName="text-text-secondary"
                description="Adicione PDFs e artigos para começar."
                verticalPosition="raised"
                surfaceMarker="action"
                action={{ label: "Adicionar documento", onClick: () => setIsAddPdfModalOpen(true) }}
              />
            ) : activeRoute.type === "all" && allDocuments.length === 0 ? (
              <EmptyState
                icon={EmptyLibraryIcon}
                iconClassName="h-12 w-[60px]"
                title="Sua biblioteca está vazia"
                titleClassName="text-text-secondary"
                description="Adicione PDFs e artigos para começar."
                verticalPosition="raised"
                surfaceMarker="action"
                action={{ label: "Adicionar documento", onClick: () => setIsAddPdfModalOpen(true) }}
              />
            ) : (
              <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
                <div className="rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold text-text-secondary">{emptyMessage}</div>
                <p className="mt-3 text-sm text-text-secondary">{emptyDescription}</p>
              </div>
            )}
          </section>

          <ContextMenu
            isOpen={libraryAreaContextMenu.isOpen}
            x={libraryAreaContextMenu.x}
            y={libraryAreaContextMenu.y}
            onClose={libraryAreaContextMenu.close}
          >
            <ContextMenuItem
              icon={<ContextCategoryIcon />}
              label="Nova coleção"
              onSelect={() => {
                libraryAreaContextMenu.close();
                setIsNewCollectionModalOpen(true);
              }}
            />
            <ContextMenuDivider />
            <ContextMenuItem
              icon={viewMode === "list" ? <ContextGridIcon /> : <ContextRowsIcon />}
              label={viewMode === "list" ? "Listar itens em grade" : "Listar itens em linhas"}
              onSelect={toggleLibraryViewModeFromContextMenu}
            />
            <ContextMenuItem
              icon={<ContextRefreshIcon />}
              label="Atualizar"
              onSelect={refreshLibraryFromContextMenu}
            />
          </ContextMenu>
        </div>

        {selectedDocument ? (
          <DocumentDetailsPanel
            document={selectedDocument}
            collections={collections}
            availableTags={availableTags}
            mode={isTrashRoute ? "trash" : "library"}
            onClose={() => setSelectedDocumentId(null)}
            onUpdateDocument={(documentId, updates) =>
              void updateDocumentMetadata(documentId, { ...updates, tags: selectedDocument.tags })
            }
            onToggleFavorite={(documentId) => void toggleFavorite(documentId)}
            onToggleReadingCompletion={(documentId) => void toggleReadingCompletion(documentId)}
            onAvailableTagsChange={updateAvailableTags}
            onUpdateNotes={(documentId, notes) => void saveDocumentNote(documentId, notes)}
            onUpdateDocumentTags={(documentId, tags) => void updateDocumentTags(documentId, tags)}
            onUpdateTagTone={(tag, tone) => void updateTagTone(tag, tone)}
            onRestore={(documentId) => void restoreFromTrash(documentId)}
            onPermanentDelete={() => setPendingConfirmation({ type: "permanent-delete", document: selectedDocument })}
          />
        ) : null}
      </div>

      {isEditCollectionModalOpen && activeCollection ? (
        <NewCollectionModal
          collection={activeCollection}
          onClose={() => setIsEditCollectionModalOpen(false)}
          onCreateCollection={({ name, description, color }) =>
            editActiveCollection(activeCollection, { name, description, color })
          }
        />
      ) : null}

      {isNewCollectionModalOpen ? (
        <NewCollectionModal
          onClose={() => setIsNewCollectionModalOpen(false)}
          onCreateCollection={({ name, description, color }) => createCollection(name, description, color)}
        />
      ) : null}

      {renameTarget ? (
        <RenameLibraryItemModal
          title={renameTarget.type === "notebook" ? "Renomear caderno" : "Renomear quadro"}
          initialName={renameTarget.title}
          onClose={() => setRenameTarget(null)}
          onRename={renameLibraryItem}
        />
      ) : null}

      {isAddPdfModalOpen ? (
        <AddDocumentModal
          collections={collections}
          availableTags={availableTags}
          existingDocuments={allDocuments}
          defaultCollectionId={activeCollection?.id}
          onClose={() => setIsAddPdfModalOpen(false)}
          onAddDocument={addDocument}
          onAvailableTagsChange={updateAvailableTags}
        />
      ) : null}

      {/* Paineis de quadro: superficie Konva em lazy-load. */}
      {floatingPanelsList
        .filter((floatingPanel) => floatingPanel.type === "canvas")
        .map((floatingPanel) => (
          <Suspense
            key={floatingPanel.id}
            fallback={
              <div className="pointer-events-none fixed inset-x-0 top-24 z-[55] flex justify-center">
                <div className="rounded-full bg-[var(--surface-header)] px-4 py-2 text-sm font-semibold text-white shadow-2xl">
                  Carregando editor de quadros
                </div>
              </div>
            }
          >
            <CanvasPanel
              panel={floatingPanel}
              title={canvases.find((canvas) => String(canvas.id) === floatingPanel.entityId)?.title ?? "Quadro"}
              onClose={() => closeFloatingPanel(floatingPanel.id)}
              onCanvasChanged={() => void queryClient.invalidateQueries({ queryKey: ["library", "canvases"] })}
            />
          </Suspense>
        ))}

      {/* Painel de Ajustes (singleton: entityId fixo "app"). Aberto pelo botao
          "Ajustes" no rodape da sidebar. */}
      {floatingPanelsList
        .filter((floatingPanel) => floatingPanel.type === "settings")
        .map((floatingPanel) => (
          <SettingsPanel key={floatingPanel.id} panel={floatingPanel} onClose={() => closeFloatingPanel(floatingPanel.id)} />
        ))}

      {fileDeletionNotice ? (
        <div
          role="status"
          data-glass-backdrop="optical"
          className="material-surface-elevated fixed bottom-6 left-1/2 z-[70] flex max-w-xl -translate-x-1/2 items-start gap-3 rounded-xl border border-border bg-surface-elevated px-4 py-3 text-sm text-text-primary shadow-lg"
        >
          <p className="flex-1">{fileDeletionNotice}</p>
          <button
            type="button"
            className="rounded-md px-2 py-1 font-bold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
            onClick={() => setFileDeletionNotice(null)}
          >
            Fechar
          </button>
        </div>
      ) : null}

      {pendingConfirmation ? (
        <ConfirmationDialog
          title={pendingConfirmation.type === "empty-trash" ? "Esvaziar lixeira?" : "Excluir permanentemente?"}
          description={
            pendingConfirmation.type === "empty-trash"
              ? "Todos os itens serão excluídos do banco. Cópias gerenciadas serão removidas; arquivos originais legados permanecerão no disco."
              : `Esta ação exclui "${pendingConfirmation.document.title}" do banco. A cópia gerenciada será removida; um arquivo original legado será preservado.`
          }
          confirmLabel={pendingConfirmation.type === "empty-trash" ? "Esvaziar lixeira" : "Excluir permanentemente"}
          tone="danger"
          onCancel={() => setPendingConfirmation(null)}
          onConfirm={() => void confirmPendingAction()}
        />
      ) : null}
    </AppShell>
  );
}

// Linha de contagem sob o titulo, sensivel a aba ativa da colecao
// ("7 itens" / "4 cadernos" / "2 quadros"). Fora de colecoes so existe a aba
// de documentos.
function getHeaderCountText(tab: CollectionTab, route: LibraryRoute, documentCount: number, notebookCount: number, canvasCount: number) {
  if (route.type === "collection" && tab === "notebooks") {
    return `${notebookCount} ${notebookCount === 1 ? "caderno" : "cadernos"}`;
  }

  if (route.type === "collection" && tab === "canvases") {
    return `${canvasCount} ${canvasCount === 1 ? "quadro" : "quadros"}`;
  }

  return `${documentCount} ${documentCount === 1 ? "item" : "itens"}`;
}

function getRouteTitle(route: LibraryRoute) {
  if (route.type === "trash") {
    return "Lixeira";
  }

  if (route.type === "favorites") {
    return "Favoritos";
  }

  if (route.type === "recent") {
    return "Recentes";
  }

  if (route.type === "reading-list") {
    return "Em andamento";
  }

  if (route.type === "collection") {
    return route.collectionName;
  }

  return "Todos os itens";
}

function mergeUniqueTags(tags: SubjectTag[]) {
  const seenTags = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.toLocaleLowerCase("pt-BR");

    if (seenTags.has(key)) {
      return false;
    }

    seenTags.add(key);
    return true;
  });
}
