import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { remove } from "@tauri-apps/plugin-fs";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../components/AppShell";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
import {
  countTrashDocuments,
  createCollection as createPersistedCollection,
  createDocument,
  deleteCollection as deletePersistedCollection,
  emptyTrash,
  getDocumentFilePaths,
  getTrashFilePaths,
  listAvailableTags,
  listCollections,
  listLibraryDocuments,
  moveDocumentToTrash,
  permanentlyDeleteDocument,
  restoreDocument,
  renameCollection as renamePersistedCollection,
  setDocumentFavorite,
  setDocumentNote,
  setDocumentReadingLocation,
  setDocumentReadingStarted,
  updateDocumentMetadata as updatePersistedDocumentMetadata,
} from "../../lib/database";
import type { DocumentMetadataUpdates, ListDocumentsOptions } from "../../lib/database";
import type { LibraryCollection, LibraryDocument, LibraryRoute, ReadingLocation, SortMode, StatusFilter, SubjectTag, ViewMode } from "../../types/library";
import { AddDocumentModal } from "./AddDocumentModal";
import { DocumentCard } from "./DocumentCard";
import { DocumentDetailsPanel } from "./DocumentDetailsPanel";
import { LibraryHeader } from "./LibraryHeader";
import { LibraryToolbar } from "./LibraryToolbar";

const ReaderModal = lazy(() => import("./ReaderModal").then((module) => ({ default: module.ReaderModal })));

type PendingConfirmation =
  | { type: "permanent-delete"; document: LibraryDocument }
  | { type: "empty-trash" }
  | null;

const allDocumentsOptions: ListDocumentsOptions = {
  searchTerm: "",
  statusFilter: "all",
  sortMode: "recentes",
  route: { type: "all" },
};

const libraryQueryKeys = {
  all: ["library"] as const,
  collections: () => ["library", "collections"] as const,
  tags: () => ["library", "tags"] as const,
  trashCount: () => ["library", "trashCount"] as const,
  documents: ({ searchTerm, statusFilter, sortMode, route }: ListDocumentsOptions) =>
    [
      "library",
      "documents",
      searchTerm,
      statusFilter,
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

export function LibraryView() {
  const queryClient = useQueryClient();
  const [activeRoute, setActiveRoute] = useState<LibraryRoute>({ type: "all" });
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recentes");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [isAddPdfModalOpen, setIsAddPdfModalOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [readerDocumentId, setReaderDocumentId] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const hasAutoSelectedFirstDocumentRef = useRef(false);

  const isTrashRoute = activeRoute.type === "trash";
  const activeDocumentsOptions = useMemo<ListDocumentsOptions>(
    () => ({ searchTerm, statusFilter, sortMode, route: activeRoute }),
    [activeRoute, searchTerm, sortMode, statusFilter],
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
    viewMode === "grid"
      ? "grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]"
      : "flex flex-col gap-3";
  const selectedDocument = selectedDocumentId ? documents.find((document) => document.id === selectedDocumentId) ?? null : null;
  const readerDocument = readerDocumentId ? allDocuments.find((document) => document.id === readerDocumentId) ?? null : null;
  const emptyMessage = isTrashRoute ? "Sua lixeira esta vazia" : "Nenhum documento encontrado";
  const emptyDescription = isTrashRoute ? "Itens movidos para a lixeira aparecem aqui por ate 30 dias." : "Ajuste a busca ou os filtros para ver a biblioteca novamente.";

  async function openForReading(documentToOpen: LibraryDocument) {
    await setDocumentReadingStarted(documentToOpen.id);
    setReaderDocumentId(documentToOpen.id);
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

  async function renameCollection(collection: LibraryCollection, name: string) {
    const renamedCollection = await renamePersistedCollection(collection.id, name);
    const nextRoute: LibraryRoute =
      activeRoute.type === "collection" && activeRoute.collectionName === collection.name
        ? { type: "collection", collectionName: renamedCollection.name }
        : activeRoute;

    setActiveRoute(nextRoute);
    await invalidateLibraryQueries();
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
      trashCount={trashCount}
      activeRoute={activeRoute}
      onRouteChange={setActiveRoute}
      onCreateCollection={createCollection}
      onRenameCollection={renameCollection}
      onDeleteCollection={deleteCollection}
    >
      <div className="flex items-center gap-3 bg-surface-app px-8 pb-2 pt-6">
        <label className="ml-auto flex w-full max-w-sm items-center gap-2 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-text-subtle">
          <SearchIcon />
          <input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Pesquisar na biblioteca..."
            className="min-w-0 flex-1 border-0 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-subtle"
          />
        </label>
        {isTrashRoute ? null : (
          <button
            type="button"
            onClick={() => setIsAddPdfModalOpen(true)}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover"
          >
            <PlusIcon />
            Adicionar
          </button>
        )}
      </div>

      <header className="flex flex-wrap items-end gap-4 bg-surface-app px-8 pb-4 pt-2">
        <LibraryHeader title={getRouteTitle(activeRoute)} count={documents.length} />
        {isTrashRoute && trashCount > 0 ? (
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-status-red px-4 py-2.5 text-sm font-bold text-status-red-text transition hover:brightness-95"
            onClick={() => setPendingConfirmation({ type: "empty-trash" })}
          >
            Esvaziar lixeira
          </button>
        ) : null}
        <LibraryToolbar
          compact={isTrashRoute}
          statusFilter={statusFilter}
          sortMode={sortMode}
          viewMode={viewMode}
          onStatusFilterChange={setStatusFilter}
          onSortModeChange={setSortMode}
          onViewModeChange={setViewMode}
        />
      </header>

      {isTrashRoute ? (
        <div className="border-b border-border-subtle bg-surface-app px-8 py-4 text-sm text-text-secondary">
          Itens na lixeira sao excluidos permanentemente apos 30 dias.
        </div>
      ) : null}

      <div className="min-h-0 flex flex-1 flex-col xl:flex-row">
        <section className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {isLoading ? (
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
                  viewMode={viewMode}
                  mode={isTrashRoute ? "trash" : "library"}
                  isSelected={document.id === selectedDocumentId}
                  onSelect={(selectedDocument) => setSelectedDocumentId(selectedDocument.id)}
                  onToggleFavorite={(nextDocumentId) => void toggleFavorite(nextDocumentId)}
                  onDelete={(nextDocumentId) => void moveToTrash(nextDocumentId)}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
              <div className="rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold text-text-secondary">{emptyMessage}</div>
              <p className="mt-3 text-sm text-text-secondary">{emptyDescription}</p>
            </div>
          )}
        </section>

        {selectedDocument ? (
          <DocumentDetailsPanel
            document={selectedDocument}
            collections={collections}
            availableTags={availableTags}
            mode={isTrashRoute ? "trash" : "library"}
            onClose={() => setSelectedDocumentId(null)}
            onOpenReader={(document) => void openForReading(document)}
            onUpdateDocument={(documentId, updates) => void updateDocumentMetadata(documentId, updates)}
            onToggleFavorite={(documentId) => void toggleFavorite(documentId)}
            onAvailableTagsChange={updateAvailableTags}
            onRestore={(documentId) => void restoreFromTrash(documentId)}
            onPermanentDelete={() => setPendingConfirmation({ type: "permanent-delete", document: selectedDocument })}
          />
        ) : null}
      </div>

      {isAddPdfModalOpen ? (
        <AddDocumentModal
          collections={collections}
          availableTags={availableTags}
          existingDocuments={allDocuments}
          onClose={() => setIsAddPdfModalOpen(false)}
          onAddDocument={addDocument}
          onAvailableTagsChange={updateAvailableTags}
        />
      ) : null}

      {readerDocument ? (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#11131d] text-sm font-semibold text-slate-200">
              Carregando leitor
            </div>
          }
        >
          <ReaderModal
            document={readerDocument}
            availableTags={availableTags}
            onAvailableTagsChange={updateAvailableTags}
            onUpdateDocumentTags={(documentId, tags) => void updateDocumentTags(documentId, tags)}
            onClose={(readingLocation) => void closeReader(readingLocation)}
            onSaveNotes={(documentId, notes) => void saveDocumentNote(documentId, notes)}
          />
        </Suspense>
      ) : null}

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
