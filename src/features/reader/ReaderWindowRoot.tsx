import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { ThemeProvider } from "../../hooks/useTheme";
import {
  getDocumentNotes,
  getLibraryDocument,
  getReaderOpensMaximized,
  setDocumentFavorite,
  setDocumentNote,
  setDocumentReadingLocation,
  setDocumentReadingStarted,
} from "../../lib/database";
import type { LibraryDocument, ReadingLocation } from "../../types/library";
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
        readerPanelSize={readerSize}
        isReaderMaximized={bootstrap.opensMaximized}
        isActiveForShortcuts={true}
        annotationsPanel={null}
        isAnnotationsPanelActiveForShortcuts={false}
        onOpenAnnotationsPanel={() => undefined}
        onCloseAnnotationsPanel={() => undefined}
        onMinimizeAnnotationsPanel={() => undefined}
        onRestoreAnnotationsPanel={() => undefined}
        onNativeFullscreenVisualStateChange={() => setReaderSize(getWindowContentSize())}
        databaseSource="preloaded"
      >
        {({ renderHeader, body, requestClose }) => {
          requestCloseRef.current = requestClose;
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

  return <ThemeProvider>{content}</ThemeProvider>;
}
