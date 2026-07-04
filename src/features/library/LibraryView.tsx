import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SVGProps } from "react";
import { remove } from "@tauri-apps/plugin-fs";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
import { EmptyState } from "../../components/EmptyState";
import {
  countTrashDocuments,
  createCanvas as createPersistedCanvas,
  createCollection as createPersistedCollection,
  createDocument,
  createNotebook as createPersistedNotebook,
  deleteCollection as deletePersistedCollection,
  emptyTrash,
  getDocumentFilePaths,
  getTrashFilePaths,
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
  restoreDocument,
  renameCanvas as renamePersistedCanvas,
  renameCollection as renamePersistedCollection,
  renameNotebook as renamePersistedNotebook,
  setCanvasFavorite,
  setDocumentFavorite,
  setDocumentNote,
  setDocumentReadingLocation,
  setDocumentReadingStarted,
  setNotebookFavorite,
  updateCollection as updatePersistedCollection,
  updateDocumentMetadata as updatePersistedDocumentMetadata,
} from "../../lib/database";
import type { CollectionUpdates, DocumentMetadataUpdates, ListDocumentsOptions } from "../../lib/database";
import type { Canvas, LibraryCollection, LibraryDocument, LibraryRoute, Notebook, ReadingLocation, SortMode, SubjectTag, ViewMode } from "../../types/library";
import { NewCollectionModal } from "../../components/NewCollectionModal";
import { floatingPanelId, getCenteredPanelPosition, useFloatingPanels } from "../../components/floating/FloatingPanelsContext";
import { CanvasesGrid } from "../canvases/CanvasesGrid";
import { canvasPanelHeight, canvasPanelWidth } from "../canvases/canvasPanelDimensions";
import { NotebookPanel, notebookPanelWidth } from "../notebooks/NotebookPanel";
import { NotebooksGrid } from "../notebooks/NotebooksGrid";
import { AddDocumentModal } from "./AddDocumentModal";
import { CollectionTabs, type CollectionTab } from "./CollectionTabs";
import { DocumentCard } from "./DocumentCard";
import { DocumentDetailsPanel } from "./DocumentDetailsPanel";
import { LibraryHeader } from "./LibraryHeader";
import { LibraryToolbar } from "./LibraryToolbar";
import { RenameLibraryItemModal } from "./RenameLibraryItemModal";

const ReaderModal = lazy(() => import("./ReaderModal").then((module) => ({ default: module.ReaderModal })));
// Lazy pelo mesmo motivo do leitor: o Excalidraw e pesado e so entra no
// bundle quando o primeiro quadro for aberto.
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

// Icones de estado vazio (equivalentes inline a LibraryBig/FolderOpen/SearchX).
// Aceitam props de SVG (className, size) para o EmptyState controlar cor/tamanho.
const emptyStateIconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function LibraryBigIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...emptyStateIconProps} {...props}>
      <rect width="8" height="18" x="3" y="3" rx="1" />
      <path d="M7 3v18" />
      <path d="M20.4 18.9c.2.5-.1 1.1-.6 1.3l-1.9.7c-.5.2-1.1-.1-1.3-.6L11.1 5.1c-.2-.5.1-1.1.6-1.3l1.9-.7c.5-.2 1.1.1 1.3.6Z" />
    </svg>
  );
}

function FolderOpenIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...emptyStateIconProps} {...props}>
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function SearchXIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...emptyStateIconProps} {...props}>
      <path d="m13.5 8.5-5 5" />
      <path d="m8.5 8.5 5 5" />
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function LibraryView() {
  const queryClient = useQueryClient();
  const { panels: floatingPanelsList, openPanel: openFloatingPanel, closePanel: closeFloatingPanel } = useFloatingPanels();
  const [activeRoute, setActiveRoute] = useState<LibraryRoute>({ type: "all" });
  const [searchTerm, setSearchTerm] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("recentes");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [collectionTab, setCollectionTab] = useState<CollectionTab>("documents");
  const [isAddPdfModalOpen, setIsAddPdfModalOpen] = useState(false);
  const [isEditCollectionModalOpen, setIsEditCollectionModalOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [readerDocumentId, setReaderDocumentId] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const hasAutoSelectedFirstDocumentRef = useRef(false);

  const isTrashRoute = activeRoute.type === "trash";
  const activeDocumentsOptions = useMemo<ListDocumentsOptions>(
    () => ({ searchTerm, sortMode, route: activeRoute }),
    [activeRoute, searchTerm, sortMode],
  );

  const collectionsQuery = useQuery({
    queryKey: libraryQueryKeys.collections(),
    queryFn: listCollections,
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

  const listClassName =
    viewMode === "list" ? "flex flex-col gap-3" : "grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]";
  const selectedDocument = selectedDocumentId ? documents.find((document) => document.id === selectedDocumentId) ?? null : null;
  const readerDocument = readerDocumentId ? allDocuments.find((document) => document.id === readerDocumentId) ?? null : null;
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
  const emptyMessage = isTrashRoute ? "Sua lixeira esta vazia" : "Nenhum documento encontrado";
  const emptyDescription = isTrashRoute ? "Itens movidos para a lixeira aparecem aqui por ate 30 dias." : "Ajuste a busca ou os filtros para ver a biblioteca novamente.";

  async function createNotebookInCollection() {
    if (!activeCollection) {
      return;
    }

    const notebook = await createPersistedNotebook(activeCollection.id);
    await queryClient.invalidateQueries({ queryKey: ["library", "notebooks"] });
    // Cascata com a largura REAL do painel (520px), para nao transbordar a
    // borda direita como acontecia com o fallback de 440px.
    openFloatingPanel("notebook", String(notebook.id), undefined, notebookPanelWidth);
  }

  function openNotebook(notebook: Notebook) {
    openFloatingPanel("notebook", String(notebook.id), undefined, notebookPanelWidth);
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
    closeFloatingPanel(floatingPanelId("notebook", String(notebook.id)));
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

  async function openForReading(documentToOpen: LibraryDocument) {
    await setDocumentReadingStarted(documentToOpen.id);

    // Um leitor por vez: abrir outro documento fecha o painel do anterior
    // (a posicao de leitura dele ja fica salva pelo autosave periodico).
    floatingPanelsList
      .filter((floatingPanel) => floatingPanel.type === "reader" && floatingPanel.entityId !== documentToOpen.id)
      .forEach((floatingPanel) => closeFloatingPanel(floatingPanel.id));

    setReaderDocumentId(documentToOpen.id);
    openFloatingPanel("reader", documentToOpen.id, getReaderInitialPosition());
    await invalidateLibraryQueries();
  }

  async function saveDocumentNote(documentId: string, note: string) {
    updateDocumentInCache(documentId, (document) => ({ ...document, notes: note }));
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
      tags,
    });
  }

  async function toggleFavorite(documentId: string) {
    const document = allDocuments.find((currentDocument) => currentDocument.id === documentId);

    if (!document) {
      return;
    }

    await setDocumentFavorite(documentId, !document.favorite);
    await invalidateLibraryQueries();
  }

  async function moveToTrash(documentId: string) {
    await moveDocumentToTrash(documentId);
    await invalidateLibraryQueries();

    if (readerDocumentId === documentId) {
      setReaderDocumentId(null);
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
      tags: document.tags,
    });
  }

  async function restoreFromTrash(documentId: string) {
    await restoreDocument(documentId);
    await invalidateLibraryQueries();
  }

  async function closeReader(readingLocation: ReadingLocation) {
    if (!readerDocument) {
      setReaderDocumentId(null);
      return;
    }

    await setDocumentReadingLocation(readerDocument, readingLocation);
    setReaderDocumentId(null);
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

  async function removeFiles(filePaths: string[]) {
    for (const filePath of filePaths) {
      try {
        await remove(filePath);
      } catch (error) {
        console.warn("Nao foi possivel remover o arquivo do disco.", filePath, error);
      }
    }
  }

  async function confirmPendingAction() {
    if (!pendingConfirmation) {
      return;
    }

    if (pendingConfirmation.type === "permanent-delete") {
      const filePaths = await getDocumentFilePaths([pendingConfirmation.document.id]);
      await removeFiles(filePaths);
      await permanentlyDeleteDocument(pendingConfirmation.document.id);
      setPendingConfirmation(null);
      await invalidateLibraryQueries();
      return;
    }

    const filePaths = await getTrashFilePaths();
    await removeFiles(filePaths);
    await emptyTrash();
    setPendingConfirmation(null);
    await invalidateLibraryQueries();
  }

  return (
    <AppShell
      collections={collections}
      documents={allDocuments}
      activeRoute={activeRoute}
      onRouteChange={setActiveRoute}
      onCreateCollection={createCollection}
      onRenameCollection={renameCollection}
      onDeleteCollection={deleteCollection}
    >
      <div className="flex h-full min-h-0 flex-1 flex-col xl:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 bg-surface-app px-8 pb-5 pt-6">
            <label className="ml-auto flex w-full max-w-sm items-center gap-2 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-text-subtle">
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
                onClick={() => setIsAddPdfModalOpen(true)}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-transparent bg-primary px-4 py-2 text-[12px] font-bold leading-[18px] text-text-inverse shadow-button transition hover:bg-primary-hover"
              >
                <PlusIcon />
                Adicionar
              </button>
            )}
          </div>

          {/* Linha horizontal de largura total, logo acima do titulo da colecao
              (diferente do divisor abaixo de "N itens", que e recuado). */}
          <div className="border-t border-border-subtle" />

          <header className="flex flex-wrap items-end gap-4 bg-surface-app px-8 pb-4 pt-5">
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
                className="inline-flex items-center gap-2 rounded-lg border border-primary bg-transparent px-4 py-2 text-[12px] font-bold leading-[18px] text-primary transition hover:bg-primary hover:text-text-inverse"
              >
                <PlusIcon />
                Criar
              </button>
            ) : (
              <LibraryToolbar
                compact={isTrashRoute}
                sortMode={sortMode}
                viewMode={viewMode}
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
            <div className="border-b border-border-subtle bg-surface-app px-8 py-4 text-sm text-text-secondary">
              Itens na lixeira sao excluidos permanentemente apos 30 dias.
            </div>
          ) : null}

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
                  Nao foi possivel carregar a biblioteca.
                </div>
              </div>
            ) : documents.length > 0 ? (
              <div className={listClassName}>
                {documents.map((document) => (
                  <DocumentCard
                    key={document.id}
                    document={document}
                    collections={collections}
                    mode={isTrashRoute ? "trash" : "library"}
                    viewMode={viewMode}
                    isSelected={document.id === selectedDocumentId}
                    onSelect={(selectedDocument) => setSelectedDocumentId(selectedDocument.id)}
                    onOpenReader={(documentToOpen) => void openForReading(documentToOpen)}
                    onOpenDetails={(selectedDocument) => setSelectedDocumentId(selectedDocument.id)}
                    onToggleFavorite={(nextDocumentId) => void toggleFavorite(nextDocumentId)}
                    onMoveToCollection={(nextDocumentId, collectionId) => void moveDocumentToCollection(nextDocumentId, collectionId)}
                    onDelete={(nextDocumentId) => void moveToTrash(nextDocumentId)}
                  />
                ))}
              </div>
            ) : hasActiveSearch ? (
              <EmptyState
                icon={SearchXIcon}
                title="Nenhum resultado"
                description="Tente outros termos ou remova os filtros ativos."
              />
            ) : activeRoute.type === "collection" ? (
              <EmptyState
                icon={FolderOpenIcon}
                title="Coleção vazia"
                description="Nenhum documento nesta coleção ainda."
                action={{ label: "Adicionar documento", onClick: () => setIsAddPdfModalOpen(true) }}
              />
            ) : allDocuments.length === 0 && !isTrashRoute ? (
              <EmptyState
                icon={LibraryBigIcon}
                title="Sua biblioteca está vazia"
                description="Adicione seu primeiro documento para começar."
                action={{ label: "Adicionar documento", onClick: () => setIsAddPdfModalOpen(true) }}
              />
            ) : (
              <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
                <div className="rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold text-text-secondary">{emptyMessage}</div>
                <p className="mt-3 text-sm text-text-secondary">{emptyDescription}</p>
              </div>
            )}
          </section>
        </div>

        {selectedDocument ? (
          <DocumentDetailsPanel
            document={selectedDocument}
            collections={collections}
            availableTags={availableTags}
            mode={isTrashRoute ? "trash" : "library"}
            onClose={() => setSelectedDocumentId(null)}
            onOpenReader={(document) => void openForReading(document)}
            onUpdateDocument={(documentId, updates) =>
              void updateDocumentMetadata(documentId, { ...updates, tags: selectedDocument.tags })
            }
            onToggleFavorite={(documentId) => void toggleFavorite(documentId)}
            onAvailableTagsChange={updateAvailableTags}
            onUpdateNotes={(documentId, notes) => void saveDocumentNote(documentId, notes)}
            onUpdateDocumentTags={(documentId, tags) => void updateDocumentTags(documentId, tags)}
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

      {readerDocument ? (
        <Suspense
          fallback={
            // O leitor agora e um painel flutuante — o fallback do lazy import
            // e um aviso discreto, nao mais uma tela cheia escura.
            <div className="pointer-events-none fixed inset-x-0 top-24 z-[55] flex justify-center">
              <div className="rounded-full bg-[var(--surface-header)] px-4 py-2 text-sm font-semibold text-white shadow-2xl">
                Carregando leitor
              </div>
            </div>
          }
        >
          <ReaderModal
            key={readerDocument.id}
            document={readerDocument}
            availableTags={availableTags}
            onAvailableTagsChange={updateAvailableTags}
            onUpdateDocumentTags={(documentId, tags) => void updateDocumentTags(documentId, tags)}
            onClose={(readingLocation) => void closeReader(readingLocation)}
            onSaveNotes={(documentId, notes) => void saveDocumentNote(documentId, notes)}
          />
        </Suspense>
      ) : null}

      {/* Paineis flutuantes de caderno abertos (a pilha permite varios ao
          mesmo tempo, inclusive junto do painel de anotacoes do leitor). */}
      {floatingPanelsList
        .filter((floatingPanel) => floatingPanel.type === "notebook")
        .map((floatingPanel) => (
          <NotebookPanel
            key={floatingPanel.id}
            panel={floatingPanel}
            collections={collections}
            onClose={() => closeFloatingPanel(floatingPanel.id)}
            onNotebookChanged={() => void queryClient.invalidateQueries({ queryKey: ["library", "notebooks"] })}
          />
        ))}

      {/* Paineis de quadro: editor Excalidraw (lazy — o chunk so carrega ao
          abrir o primeiro quadro). */}
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

      {pendingConfirmation ? (
        <ConfirmationDialog
          title={pendingConfirmation.type === "empty-trash" ? "Esvaziar lixeira?" : "Excluir permanentemente?"}
          description={
            pendingConfirmation.type === "empty-trash"
              ? "Todos os itens na lixeira serao excluidos do banco e os arquivos locais correspondentes serao removidos do disco."
              : `Esta acao exclui "${pendingConfirmation.document.title}" do banco e remove o arquivo local correspondente.`
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

// Posicao inicial do painel do leitor: centralizado horizontalmente, logo
// abaixo do header do app (espelha o calculo de largura do ReaderModal).
function getReaderInitialPosition() {
  const readerWidth = Math.max(720, Math.min(1240, window.innerWidth - 64));
  return {
    x: Math.max(8, Math.round((window.innerWidth - readerWidth) / 2)),
    y: 84,
  };
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
    return "Reading List";
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
