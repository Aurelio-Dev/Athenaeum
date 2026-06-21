import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { remove } from "@tauri-apps/plugin-fs";
import { AppShell } from "../../components/AppShell";
import { ConfirmationDialog } from "../../components/ConfirmationDialog";
import {
  createDocument,
  emptyTrash,
  getDocumentFilePaths,
  getTrashFilePaths,
  loadLibrarySnapshot,
  moveDocumentToTrash,
  permanentlyDeleteDocument,
  restoreDocument,
  setDocumentFavorite,
  setDocumentNote,
  setDocumentReadingLocation,
  setDocumentReadingStarted,
  updateDocumentMetadata as updatePersistedDocumentMetadata,
} from "../../lib/database";
import type { DocumentMetadataUpdates } from "../../lib/database";
import type { LibraryCollection, LibraryDocument, LibraryRoute, ReadingLocation, SortMode, StatusFilter, SubjectTag, ViewMode } from "../../types/library";
import { AddPdfModal } from "./AddPdfModal";
import { DocumentCard } from "./DocumentCard";
import { DocumentDetailsPanel } from "./DocumentDetailsPanel";
import { LibraryHeader } from "./LibraryHeader";
import { LibraryToolbar } from "./LibraryToolbar";

const ReaderModal = lazy(() => import("./ReaderModal").then((module) => ({ default: module.ReaderModal })));

type PendingConfirmation =
  | { type: "permanent-delete"; document: LibraryDocument }
  | { type: "empty-trash" }
  | null;

export function LibraryView() {
  const [allDocuments, setAllDocuments] = useState<LibraryDocument[]>([]);
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [collections, setCollections] = useState<LibraryCollection[]>([]);
  const [availableTags, setAvailableTags] = useState<SubjectTag[]>([]);
  const [trashCount, setTrashCount] = useState(0);
  const [activeRoute, setActiveRoute] = useState<LibraryRoute>({ type: "all" });
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("recentes");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [isAddPdfModalOpen, setIsAddPdfModalOpen] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [readerDocumentId, setReaderDocumentId] = useState<string | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const isTrashRoute = activeRoute.type === "trash";

  const refreshLibrary = useCallback(async () => {
    const snapshot = await loadLibrarySnapshot({ searchTerm, statusFilter, sortMode, route: activeRoute });

    setAllDocuments(snapshot.allDocuments);
    setDocuments(snapshot.documents);
    setCollections(snapshot.collections);
    setAvailableTags(snapshot.availableTags);
    setTrashCount(snapshot.trashCount);
    setSelectedDocumentId((currentDocumentId) => {
      if (currentDocumentId && snapshot.documents.some((document) => document.id === currentDocumentId)) {
        return currentDocumentId;
      }

      return snapshot.documents[0]?.id ?? null;
    });
  }, [activeRoute, searchTerm, sortMode, statusFilter]);

  useEffect(() => {
    let isCancelled = false;

    async function loadSnapshot() {
      setIsLoading(true);
      setLoadError("");

      try {
        const snapshot = await loadLibrarySnapshot({ searchTerm, statusFilter, sortMode, route: activeRoute });

        if (isCancelled) {
          return;
        }

        setAllDocuments(snapshot.allDocuments);
        setDocuments(snapshot.documents);
        setCollections(snapshot.collections);
        setAvailableTags(snapshot.availableTags);
        setTrashCount(snapshot.trashCount);
        setSelectedDocumentId((currentDocumentId) => {
          if (currentDocumentId && snapshot.documents.some((document) => document.id === currentDocumentId)) {
            return currentDocumentId;
          }

          return snapshot.documents[0]?.id ?? null;
        });
      } catch (error) {
        if (!isCancelled) {
          console.error("Nao foi possivel carregar a biblioteca.", error);
          setLoadError("Nao foi possivel carregar a biblioteca.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadSnapshot();

    return () => {
      isCancelled = true;
    };
  }, [activeRoute, searchTerm, sortMode, statusFilter]);

  const listClassName = viewMode === "grid" ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3";
  const selectedDocument = selectedDocumentId ? documents.find((document) => document.id === selectedDocumentId) ?? null : null;
  const readerDocument = readerDocumentId ? allDocuments.find((document) => document.id === readerDocumentId) ?? null : null;
  const emptyMessage = isTrashRoute ? "Sua lixeira esta vazia" : "Nenhum documento encontrado";
  const emptyDescription = isTrashRoute ? "Itens movidos para a lixeira aparecem aqui por ate 30 dias." : "Ajuste a busca ou os filtros para ver a biblioteca novamente.";

  async function openForReading(documentToOpen: LibraryDocument) {
    await setDocumentReadingStarted(documentToOpen.id);
    setReaderDocumentId(documentToOpen.id);
    await refreshLibrary();
  }

  async function saveDocumentNote(documentId: string, note: string) {
    setDocuments((currentDocuments) =>
      currentDocuments.map((document) => (document.id === documentId ? { ...document, notes: note } : document)),
    );
    setAllDocuments((currentDocuments) =>
      currentDocuments.map((document) => (document.id === documentId ? { ...document, notes: note } : document)),
    );
    await setDocumentNote(documentId, note);
  }

  async function updateDocumentMetadata(documentId: string, updates: DocumentMetadataUpdates) {
    await updatePersistedDocumentMetadata(documentId, updates);
    setAvailableTags((currentTags) => mergeUniqueTags([...currentTags, ...updates.tags]));
    await refreshLibrary();
  }

  async function toggleFavorite(documentId: string) {
    const document = allDocuments.find((currentDocument) => currentDocument.id === documentId);

    if (!document) {
      return;
    }

    await setDocumentFavorite(documentId, !document.favorite);
    await refreshLibrary();
  }

  async function moveToTrash(documentId: string) {
    await moveDocumentToTrash(documentId);
    await refreshLibrary();

    if (readerDocumentId === documentId) {
      setReaderDocumentId(null);
    }
  }

  async function restoreFromTrash(documentId: string) {
    await restoreDocument(documentId);
    await refreshLibrary();
  }

  async function closeReader(readingLocation: ReadingLocation) {
    if (!readerDocument) {
      setReaderDocumentId(null);
      return;
    }

    await setDocumentReadingLocation(readerDocument, readingLocation);
    setReaderDocumentId(null);
    await refreshLibrary();
  }

  async function addDocument(document: LibraryDocument) {
    await createDocument(document);
    await refreshLibrary();
    setSelectedDocumentId(document.id);
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
      await refreshLibrary();
      return;
    }

    const filePaths = await getTrashFilePaths();
    await removeFiles(filePaths);
    await emptyTrash();
    setPendingConfirmation(null);
    await refreshLibrary();
  }

  return (
    <AppShell
      collections={collections}
      documents={allDocuments}
      trashCount={trashCount}
      activeRoute={activeRoute}
      searchTerm={searchTerm}
      onSearchTermChange={setSearchTerm}
      onRouteChange={setActiveRoute}
    >
      <header className="flex flex-wrap items-center gap-4 border-b border-border-subtle bg-surface-panel px-8 py-6">
        <LibraryHeader title={getRouteTitle(activeRoute)} count={documents.length} subtitle={getRouteSubtitle(activeRoute, allDocuments.length)} />
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
          onAddPdf={() => setIsAddPdfModalOpen(true)}
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
          ) : loadError ? (
            <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
              <div className="rounded-full bg-status-red px-4 py-2 text-sm font-semibold text-status-red-text">{loadError}</div>
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
            onAvailableTagsChange={setAvailableTags}
            onRestore={(documentId) => void restoreFromTrash(documentId)}
            onPermanentDelete={() => setPendingConfirmation({ type: "permanent-delete", document: selectedDocument })}
          />
        ) : null}
      </div>

      {isAddPdfModalOpen ? (
        <AddPdfModal
          collections={collections}
          availableTags={availableTags}
          onClose={() => setIsAddPdfModalOpen(false)}
          onAddDocument={addDocument}
          onAvailableTagsChange={setAvailableTags}
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
          <ReaderModal document={readerDocument} onClose={(readingLocation) => void closeReader(readingLocation)} onSaveNotes={(documentId, notes) => void saveDocumentNote(documentId, notes)} />
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

function getRouteSubtitle(route: LibraryRoute, documentCount: number) {
  if (route.type === "trash") {
    return "";
  }

  return `${documentCount} documentos na biblioteca`;
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
