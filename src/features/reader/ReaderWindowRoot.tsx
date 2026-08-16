import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeProvider } from "../../hooks/useTheme";
import {
  getDocumentNotes,
  getLibraryDocument,
  getReaderOpensMaximized,
  isReaderAnnotationsFilterScopeChangedPayload,
  isReaderDocumentPayload,
  READER_ANNOTATIONS_FILTER_SCOPE_CHANGED_EVENT,
  READER_SWITCH_DOCUMENT_EVENT,
  setDocumentFavorite,
  setDocumentNote,
  setDocumentReadingLocation,
  setDocumentReadingStarted,
  updateDocumentReadingStatus,
} from "../../lib/database";
import type { DocumentStatus, LibraryDocument, ReadingLocation } from "../../types/library";
import { ReaderContent, type ReaderContentSize } from "./ReaderContent";

type ReaderWindowRootProps = {
  documentId: string;
};

type ReaderWindowBootstrap = {
  document: LibraryDocument;
  opensMaximized: boolean;
};

function getWindowContentSize(): ReaderContentSize {
  return {
    width: Math.max(1, window.innerWidth),
    height: Math.max(1, window.innerHeight),
  };
}

// Raiz standalone do Reader nativo (?readerWindow=1&documentId=...). Todo
// acesso SQLite usa o handle preloaded criado pelo plugin SQL; esta arvore nao
// chama Database.load e nao depende da janela main nem de FloatingPanelsContext.
export function ReaderWindowRoot({ documentId }: ReaderWindowRootProps) {
  const [bootstrap, setBootstrap] = useState<ReaderWindowBootstrap | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [readerSize, setReaderSize] = useState<ReaderContentSize>(getWindowContentSize);
  const documentRef = useRef<LibraryDocument | null>(null);
  const requestCloseRef = useRef<(() => Promise<void>) | null>(null);
  const switchDocumentRef = useRef<((documentId: string) => Promise<void>) | null>(null);
  const pendingDocumentSwitchesRef = useRef<string[]>([]);
  const closeWindowPromiseRef = useRef<Promise<void> | null>(null);
  const hasValidDocumentId = documentId.length > 0;

  useEffect(() => {
    if (!hasValidDocumentId) {
      setLoadError(true);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        await setDocumentReadingStarted(documentId, "preloaded");
        const [loadedDocument, notes, opensMaximized] = await Promise.all([
          getLibraryDocument(documentId, "preloaded"),
          getDocumentNotes(documentId, "preloaded"),
          getReaderOpensMaximized("preloaded").catch(() => true),
        ]);

        if (!loadedDocument) {
          throw new Error("Documento nao encontrado.");
        }

        if (cancelled) {
          return;
        }

        const document = { ...loadedDocument, notes };
        documentRef.current = document;
        setBootstrap({ document, opensMaximized });
      } catch (error) {
        console.warn("Nao foi possivel carregar a janela do Reader.", error);
        if (!cancelled) {
          setLoadError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentId, hasValidDocumentId]);

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    void listen<unknown>(READER_SWITCH_DOCUMENT_EVENT, (event) => {
      if (!isReaderDocumentPayload(event.payload)) {
        return;
      }

      const switchReaderDocument = switchDocumentRef.current;
      if (!switchReaderDocument) {
        pendingDocumentSwitchesRef.current.push(event.payload.documentId);
        return;
      }

      void switchReaderDocument(event.payload.documentId).catch((error) => {
        console.warn("Nao foi possivel trocar o documento da janela do Reader.", error);
      });
    })
      .then((removeListener) => {
        if (isDisposed) {
          removeListener();
          return;
        }
        unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Nao foi possivel escutar pedidos de troca do Reader.", error);
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    void listen<unknown>(READER_ANNOTATIONS_FILTER_SCOPE_CHANGED_EVENT, (event) => {
      if (!isReaderAnnotationsFilterScopeChangedPayload(event.payload)) {
        return;
      }

      const { documentId: changedDocumentId, scope } = event.payload;
      setBootstrap((current) => {
        if (!current || current.document.id !== changedDocumentId) {
          return current;
        }

        const document = { ...current.document, annotationsFilterScope: scope };
        documentRef.current = document;
        return { ...current, document };
      });
    })
      .then((removeListener) => {
        if (isDisposed) {
          removeListener();
          return;
        }
        unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Nao foi possivel sincronizar o filtro de anotacoes no Reader.", error);
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const switchReaderDocument = switchDocumentRef.current;
    if (!bootstrap || !switchReaderDocument || pendingDocumentSwitchesRef.current.length === 0) {
      return;
    }

    const pendingDocumentSwitches = pendingDocumentSwitchesRef.current.splice(0);
    pendingDocumentSwitches.forEach((pendingDocumentId) => {
      void switchReaderDocument(pendingDocumentId).catch((error) => {
        console.warn("Nao foi possivel concluir uma troca pendente do Reader.", error);
      });
    });
  }, [bootstrap]);

  useEffect(() => {
    function synchronizeReaderSize() {
      setReaderSize(getWindowContentSize());
    }

    window.addEventListener("resize", synchronizeReaderSize);
    return () => window.removeEventListener("resize", synchronizeReaderSize);
  }, []);

  const destroyWindow = useCallback(async () => {
    await invoke("close_reader_window");
  }, []);

  const closeAfterContentFlush = useCallback(
    async (readingLocation: ReadingLocation) => {
      const currentDocument = documentRef.current;
      if (currentDocument) {
        await setDocumentReadingLocation(currentDocument, readingLocation, "preloaded");
      }
      await destroyWindow();
    },
    [destroyWindow],
  );

  const closeWindow = useCallback(async () => {
    if (closeWindowPromiseRef.current) {
      return closeWindowPromiseRef.current;
    }

    const closePromise = (async () => {
      const requestClose = requestCloseRef.current;
      if (!requestClose) {
        await destroyWindow();
        return;
      }

      await requestClose();
    })();

    closeWindowPromiseRef.current = closePromise;
    try {
      await closePromise;
    } finally {
      if (closeWindowPromiseRef.current === closePromise) {
        closeWindowPromiseRef.current = null;
      }
    }
  }, [destroyWindow]);

  useEffect(() => {
    let isDisposed = false;
    const listenerRegistration: { unlisten: (() => void) | null } = { unlisten: null };

    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void closeWindow().catch((error) => {
          console.warn("Nao foi possivel concluir o fechamento da janela do Reader.", error);
        });
      })
      .then((removeListener) => {
        if (isDisposed) {
          removeListener();
          return;
        }
        listenerRegistration.unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Nao foi possivel interceptar o fechamento da janela do Reader.", error);
      });

    return () => {
      isDisposed = true;
      listenerRegistration.unlisten?.();
    };
  }, [closeWindow]);

  async function saveNotes(targetDocumentId: string, notes: string) {
    await setDocumentNote(targetDocumentId, notes, "preloaded");
    setBootstrap((current) => {
      if (!current || current.document.id !== targetDocumentId) {
        return current;
      }
      const document = { ...current.document, notes };
      documentRef.current = document;
      return { ...current, document };
    });
  }

  function applyReloadedNotes(targetDocumentId: string, notes: string) {
    setBootstrap((current) => {
      if (!current || current.document.id !== targetDocumentId) {
        return current;
      }
      const document = { ...current.document, notes };
      documentRef.current = document;
      return { ...current, document };
    });
  }

  const applySwitchedDocument = useCallback((nextDocument: LibraryDocument) => {
    documentRef.current = nextDocument;
    setLoadError(false);
    setBootstrap((current) => current ? { ...current, document: nextDocument } : current);
  }, []);

  async function toggleFavorite(targetDocumentId: string) {
    const currentDocument = documentRef.current;
    if (!currentDocument || currentDocument.id !== targetDocumentId) {
      return;
    }

    const favorite = !currentDocument.favorite;
    await setDocumentFavorite(targetDocumentId, favorite, "preloaded");
    setBootstrap((current) => {
      if (!current || current.document.id !== targetDocumentId) {
        return current;
      }
      const document = { ...current.document, favorite };
      documentRef.current = document;
      return { ...current, document };
    });
  }

  // A escrita vem antes do setBootstrap de proposito: se updateDocumentReadingStatus
  // lancar, o estado nao e tocado e o card continua exibindo o status persistido.
  async function updateReadingStatus(targetDocumentId: string, status: DocumentStatus) {
    const currentDocument = documentRef.current;
    if (!currentDocument || currentDocument.id !== targetDocumentId) {
      return;
    }

    await updateDocumentReadingStatus(targetDocumentId, status, "preloaded");
    setBootstrap((current) => {
      if (!current || current.document.id !== targetDocumentId) {
        return current;
      }
      const document = { ...current.document, status };
      documentRef.current = document;
      return { ...current, document };
    });
  }

  let content = (
    <div className="flex h-screen items-center justify-center bg-[var(--background)] text-sm font-semibold text-[var(--muted-foreground)]">
      Carregando...
    </div>
  );

  if (loadError) {
    content = (
      <div className="flex h-screen items-center justify-center bg-[var(--background)] px-6 text-center text-sm font-semibold text-status-red-text">
        Nao foi possivel carregar o documento no Reader.
      </div>
    );
  } else if (bootstrap) {
    content = (
      <ReaderContent
        document={bootstrap.document}
        onClose={closeAfterContentFlush}
        onSaveNotes={saveNotes}
        onNotesReloaded={applyReloadedNotes}
        onToggleFavorite={toggleFavorite}
        onUpdateReadingStatus={updateReadingStatus}
        readerPanelSize={readerSize}
        isReaderMaximized={bootstrap.opensMaximized}
        isActiveForShortcuts={true}
        onNativeFullscreenVisualStateChange={() => setReaderSize(getWindowContentSize())}
        onDocumentSwitched={applySwitchedDocument}
        databaseSource="preloaded"
      >
        {({ renderHeader, body, requestClose, switchDocument }) => {
          requestCloseRef.current = requestClose;
          switchDocumentRef.current = switchDocument;
          return (
            <div className="flex h-screen flex-col overflow-hidden bg-[var(--card)]">
              {renderHeader()}
              <div className="flex min-h-0 flex-1 flex-col">{body}</div>
            </div>
          );
        }}
      </ReaderContent>
    );
  }

  // databaseSource="preloaded" pelo mesmo motivo de todo acesso SQLite desta
  // arvore: a janela nao pode chamar Database.load.
  return <ThemeProvider databaseSource="preloaded">{content}</ThemeProvider>;
}
