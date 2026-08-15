import { invoke } from "@tauri-apps/api/core";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAnnotation,
  getLibraryDocument,
  getDocumentNotes,
  isReaderAnnotationsFilterScopeChangedPayload,
  isReaderDocumentPayload,
  isReaderInvalidationPayload,
  isReaderPageStatePayload,
  listAnnotations,
  listAvailableTagsFromPreloadedDatabase,
  READER_ANNOTATIONS_CHANGED_EVENT,
  READER_ANNOTATIONS_FILTER_SCOPE_CHANGED_EVENT,
  READER_DETAILS_CHANGED_EVENT,
  READER_JUMP_TO_PAGE_EVENT,
  READER_NOTES_CHANGED_EVENT,
  READER_PAGE_STATE_CHANGED_EVENT,
  READER_PAGE_STATE_REQUESTED_EVENT,
  READER_POPOUT_CLOSED_EVENT,
  READER_POPOUT_STATUS_CHANGED_EVENT,
  READER_POPOUT_STATUS_REQUESTED_EVENT,
  READER_SET_DOCUMENT_EVENT,
  READER_WINDOW_LABEL,
  setDocumentNote,
  updateAnnotationNote,
} from "../../lib/database";
import type { ReaderDocumentPayload, ReaderJumpToPagePayload } from "../../lib/database";
import type { Annotation } from "../../types/annotation";
import type { LibraryDocument } from "../../types/library";
import { AiTab } from "./panels/AiTab";
import { AnnotationsTab } from "./panels/AnnotationsTab";

type ReaderPanelPopoutProps = {
  documentId: string;
};

type ReaderTab = "annotations" | "ai";

const tabs: Array<{ id: ReaderTab; label: string }> = [
  { id: "annotations", label: "Anotações" },
  { id: "ai", label: "ASK IA" },
];

export function ReaderPanelPopout({ documentId: initialDocumentId }: ReaderPanelPopoutProps) {
  const [documentId, setDocumentId] = useState(initialDocumentId);
  const documentIdRef = useRef(initialDocumentId);
  const [activeTab, setActiveTab] = useState<ReaderTab>("annotations");
  const [documentDetails, setDocumentDetails] = useState<LibraryDocument | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [, setNotesText] = useState("");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const notesSaveTimerRef = useRef<number | null>(null);
  const latestNotesRef = useRef("");
  const lastPersistedNotesRef = useRef("");
  const notesSavePromiseRef = useRef<Promise<void>>(Promise.resolve());
  const notesReloadSequenceRef = useRef(0);
  const annotationsReloadSequenceRef = useRef(0);
  const documentSwitchPromiseRef = useRef<Promise<void>>(Promise.resolve());
  const preloadedSwitchDocumentIdRef = useRef<string | null>(null);
  const closeWindowPromiseRef = useRef<Promise<void> | null>(null);

  const loadDocumentNotes = useCallback(
    (targetDocumentId: string) => getDocumentNotes(targetDocumentId, "preloaded"),
    [],
  );
  const loadDocumentAnnotations = useCallback(
    (targetDocumentId: string) => listAnnotations(targetDocumentId, "preloaded"),
    [],
  );
  const loadDocumentDetails = useCallback(
    (targetDocumentId: string) => getLibraryDocument(targetDocumentId, "preloaded"),
    [],
  );

  const applyLoadedNotes = useCallback((notes: string) => {
    setNotesText(notes);
    latestNotesRef.current = notes;
    lastPersistedNotesRef.current = notes;
  }, []);

  const applyLoadedDocument = useCallback((loadedDocument: LibraryDocument) => {
    setDocumentDetails(loadedDocument);
    setCurrentPage(loadedDocument.readingLocation?.page ?? 1);
  }, []);

  useEffect(() => {
    if (preloadedSwitchDocumentIdRef.current === documentId) {
      preloadedSwitchDocumentIdRef.current = null;
      return;
    }

    let isCancelled = false;
    const notesRequestSequence = ++notesReloadSequenceRef.current;
    const annotationsRequestSequence = ++annotationsReloadSequenceRef.current;
    setIsLoading(true);
    setErrorMessage("");

    if (!documentId) {
      setIsLoading(false);
      return () => {
        isCancelled = true;
      };
    }

    Promise.all([
      loadDocumentNotes(documentId),
      loadDocumentAnnotations(documentId),
      loadDocumentDetails(documentId),
      listAvailableTagsFromPreloadedDatabase(),
    ])
      .then(([notes, loadedAnnotations, loadedDocument]) => {
        if (isCancelled) {
          return;
        }

        if (!loadedDocument) {
          throw new Error("Documento nao encontrado.");
        }

        if (notesRequestSequence === notesReloadSequenceRef.current) {
          applyLoadedNotes(notes);
        }
        if (annotationsRequestSequence === annotationsReloadSequenceRef.current) {
          setAnnotations(loadedAnnotations);
        }
        applyLoadedDocument(loadedDocument);
      })
      .catch((error) => {
        console.warn("Nao foi possivel carregar as notas e anotacoes.", error);
        if (!isCancelled) {
          setErrorMessage("Nao foi possivel carregar as notas e anotacoes deste documento.");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [applyLoadedDocument, applyLoadedNotes, documentId, loadDocumentAnnotations, loadDocumentDetails, loadDocumentNotes]);

  useEffect(() => {
    let isDisposed = false;
    const unlistenCallbacks: Array<() => void> = [];
    const currentWindowLabel = getCurrentWebviewWindow().label;

    function registerListener<T>(
      eventName: string,
      handler: (payload: T) => void,
      onRegistered?: () => void,
    ) {
      void listen<T>(eventName, (event) => handler(event.payload))
        .then((unlisten) => {
          if (isDisposed) {
            unlisten();
            return;
          }

          unlistenCallbacks.push(unlisten);
          onRegistered?.();
        })
        .catch((error) => {
          console.warn(`Nao foi possivel escutar o evento ${eventName}.`, error);
        });
    }

    registerListener<unknown>(READER_NOTES_CHANGED_EVENT, (payload) => {
      if (
        !isReaderInvalidationPayload(payload) ||
        payload.documentId !== documentId ||
        payload.origin === currentWindowLabel
      ) {
        return;
      }

      const requestSequence = ++notesReloadSequenceRef.current;
      void loadDocumentNotes(documentId)
        .then((loadedNotes) => {
          if (isDisposed || requestSequence !== notesReloadSequenceRef.current) {
            return;
          }

          applyLoadedNotes(loadedNotes);
        })
        .catch((error) => {
          console.warn("Nao foi possivel recarregar as notas da popout.", error);
        });
    });

    registerListener<unknown>(READER_ANNOTATIONS_CHANGED_EVENT, (payload) => {
      if (
        !isReaderInvalidationPayload(payload) ||
        payload.documentId !== documentId ||
        payload.origin === currentWindowLabel
      ) {
        return;
      }

      const requestSequence = ++annotationsReloadSequenceRef.current;
      void loadDocumentAnnotations(documentId)
        .then((loadedAnnotations) => {
          if (isDisposed || requestSequence !== annotationsReloadSequenceRef.current) {
            return;
          }

          setAnnotations(loadedAnnotations);
        })
        .catch((error) => {
          console.warn("Nao foi possivel recarregar as anotacoes da popout.", error);
        });
    });

    registerListener<unknown>(READER_ANNOTATIONS_FILTER_SCOPE_CHANGED_EVENT, (payload) => {
      if (
        !isReaderAnnotationsFilterScopeChangedPayload(payload) ||
        payload.documentId !== documentId
      ) {
        return;
      }

      setDocumentDetails((current) =>
        current?.id === payload.documentId
          ? { ...current, annotationsFilterScope: payload.scope }
          : current,
      );
    });

    registerListener<unknown>(READER_DETAILS_CHANGED_EVENT, (payload) => {
      if (
        !isReaderInvalidationPayload(payload) ||
        payload.documentId !== documentId ||
        payload.origin === currentWindowLabel
      ) {
        return;
      }

      void loadDocumentDetails(documentId)
        .then((loadedDocument) => {
          if (!isDisposed && loadedDocument) {
            setDocumentDetails(loadedDocument);
          }
        })
        .catch((error) => {
          console.warn("Nao foi possivel recarregar os detalhes da popout.", error);
        });
    });

    registerListener<unknown>(READER_PAGE_STATE_CHANGED_EVENT, (payload) => {
      if (!isReaderPageStatePayload(payload) || payload.documentId !== documentId) {
        return;
      }

      setCurrentPage(payload.page);
    }, () => {
      void emitTo<ReaderDocumentPayload>(READER_WINDOW_LABEL, READER_PAGE_STATE_REQUESTED_EVENT, { documentId })
        .catch((error) => {
          console.warn("Nao foi possivel solicitar o estado atual do Reader.", error);
        });
    });

    return () => {
      isDisposed = true;
      unlistenCallbacks.splice(0).forEach((unlisten) => unlisten());
    };
  }, [applyLoadedNotes, documentId, loadDocumentAnnotations, loadDocumentDetails, loadDocumentNotes]);

  const persistNotes = useCallback(
    (targetDocumentId: string, notes: string) => {
      if (notes === lastPersistedNotesRef.current) {
        return notesSavePromiseRef.current;
      }

      const savePromise = notesSavePromiseRef.current
        .catch(() => undefined)
        .then(() => setDocumentNote(targetDocumentId, notes, "preloaded"))
        .then(() => {
          lastPersistedNotesRef.current = notes;
          setErrorMessage("");
        });

      notesSavePromiseRef.current = savePromise;
      return savePromise;
    },
    [],
  );

  const flushNotes = useCallback(async () => {
    if (notesSaveTimerRef.current !== null) {
      window.clearTimeout(notesSaveTimerRef.current);
      notesSaveTimerRef.current = null;
    }

    try {
      await persistNotes(documentIdRef.current, latestNotesRef.current);
    } catch (error) {
      console.warn("Nao foi possivel salvar as notas.", error);
      setErrorMessage("Nao foi possivel salvar as notas. Tente novamente antes de fechar.");
      throw error;
    }
  }, [persistNotes]);

  useEffect(() => {
    return () => {
      if (notesSaveTimerRef.current !== null) {
        window.clearTimeout(notesSaveTimerRef.current);
        notesSaveTimerRef.current = null;
        void persistNotes(documentIdRef.current, latestNotesRef.current).catch((error) => {
          console.warn("Nao foi possivel salvar as notas ao fechar a popout.", error);
        });
      }
    };
  }, [persistNotes]);

  async function handleUpdateAnnotationNote(annotationId: string, note: string) {
    await updateAnnotationNote(annotationId, note, "preloaded");
    const updatedAt = new Date().toISOString();
    setAnnotations((current) => current.map((annotation) => (annotation.id === annotationId ? { ...annotation, note, updatedAt } : annotation)));
  }

  function handleDeleteAnnotation(annotationId: string) {
    void deleteAnnotation(annotationId, "preloaded")
      .then(() => {
        setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
      })
      .catch((error) => {
        console.warn("Nao foi possivel remover a anotacao.", error);
        setErrorMessage("Nao foi possivel remover a anotacao.");
      });
  }

  function handleJumpToPage(page: number, annotationId?: string) {
    const payload: ReaderJumpToPagePayload = annotationId
      ? { documentId, page, annotationId }
      : { documentId, page };

    void emitTo<ReaderJumpToPagePayload>(READER_WINDOW_LABEL, READER_JUMP_TO_PAGE_EVENT, payload).catch((error) => {
      console.warn("Nao foi possivel solicitar a navegacao para a pagina.", error);
    });
  }

  // Titulo junto: o Caderno abre como janela nativa (open_notebook_window
  // exige o titulo para a barra da janela).
  function requestOpenNotebook(notebookId: number, notebookTitle: string) {
    void invoke("open_notebook_window", { notebookId, notebookTitle }).catch((error) => {
      console.warn("Nao foi possivel abrir a janela do Caderno.", error);
    });
  }

  const notifyPopoutClosed = useCallback(async (closedDocumentId: string) => {
    await emit<ReaderDocumentPayload>(READER_POPOUT_CLOSED_EVENT, { documentId: closedDocumentId });
  }, []);

  const notifyPopoutStatus = useCallback(async (openDocumentId: string) => {
    await emitTo<ReaderDocumentPayload>(READER_WINDOW_LABEL, READER_POPOUT_STATUS_CHANGED_EVENT, {
      documentId: openDocumentId,
    });
  }, []);

  const switchDocument = useCallback(
    (nextDocumentId: string) => {
      const switchPromise = documentSwitchPromiseRef.current
        .catch(() => undefined)
        .then(async () => {
          const previousDocumentId = documentIdRef.current;
          if (nextDocumentId === previousDocumentId) {
            return;
          }

          setIsLoading(true);
          setErrorMessage("");

          try {
            await flushNotes();
            const [loadedNotes, loadedAnnotations, loadedDocument] = await Promise.all([
              loadDocumentNotes(nextDocumentId),
              loadDocumentAnnotations(nextDocumentId),
              loadDocumentDetails(nextDocumentId),
              listAvailableTagsFromPreloadedDatabase(),
            ]);

            if (!loadedDocument) {
              throw new Error("Documento nao encontrado.");
            }

            await notifyPopoutClosed(previousDocumentId);

            // Invalida leituras ainda em voo do documento anterior antes de
            // publicar o novo ID e os dados carregados do SQLite.
            notesReloadSequenceRef.current += 1;
            annotationsReloadSequenceRef.current += 1;
            preloadedSwitchDocumentIdRef.current = nextDocumentId;
            documentIdRef.current = nextDocumentId;
            setDocumentId(nextDocumentId);
            applyLoadedNotes(loadedNotes);
            setAnnotations(loadedAnnotations);
            applyLoadedDocument(loadedDocument);
            await notifyPopoutStatus(nextDocumentId);
          } catch (error) {
            console.warn("Nao foi possivel trocar o documento da popout.", error);
            setErrorMessage("Nao foi possivel carregar o novo documento.");
            // O invoke da principal ja marcou o novo documento como aberto.
            // Se a troca falhou, devolvemos imediatamente a edicao dele.
            void notifyPopoutClosed(nextDocumentId).catch((notificationError) => {
              console.warn("Nao foi possivel liberar a edicao do novo documento.", notificationError);
            });
            throw error;
          } finally {
            setIsLoading(false);
          }
        });

      documentSwitchPromiseRef.current = switchPromise;
      return switchPromise;
    },
    [applyLoadedDocument, applyLoadedNotes, flushNotes, loadDocumentAnnotations, loadDocumentDetails, loadDocumentNotes, notifyPopoutClosed, notifyPopoutStatus],
  );

  useEffect(() => {
    let isDisposed = false;
    const unlistenCallbacks: Array<() => void> = [];

    function registerListener<T>(eventName: string, handler: (payload: T) => void) {
      void listen<T>(eventName, (event) => handler(event.payload))
        .then((unlisten) => {
          if (isDisposed) {
            unlisten();
            return;
          }

          unlistenCallbacks.push(unlisten);
        })
        .catch((error) => {
          console.warn(`Nao foi possivel escutar o evento ${eventName}.`, error);
        });
    }

    registerListener<unknown>(READER_SET_DOCUMENT_EVENT, (payload) => {
      if (!isReaderDocumentPayload(payload)) {
        return;
      }

      void switchDocument(payload.documentId).catch(() => undefined);
    });

    registerListener<unknown>(READER_POPOUT_STATUS_REQUESTED_EVENT, () => {
      void notifyPopoutStatus(documentIdRef.current).catch((error) => {
        console.warn("Nao foi possivel informar o estado da popout ao Reader.", error);
      });
    });

    return () => {
      isDisposed = true;
      unlistenCallbacks.splice(0).forEach((unlisten) => unlisten());
    };
  }, [notifyPopoutStatus, switchDocument]);

  const closeWindow = useCallback(async () => {
    if (closeWindowPromiseRef.current) {
      return closeWindowPromiseRef.current;
    }

    const closePromise = (async () => {
      try {
        await flushNotes();
        await notifyPopoutClosed(documentIdRef.current);
        await invoke("close_reader_panel_window");
      } catch (error) {
        console.warn("Nao foi possivel fechar a popout.", error);
        throw error;
      }
    })();

    closeWindowPromiseRef.current = closePromise;
    try {
      await closePromise;
    } finally {
      if (closeWindowPromiseRef.current === closePromise) {
        closeWindowPromiseRef.current = null;
      }
    }
  }, [flushNotes, notifyPopoutClosed]);

  useEffect(() => {
    let isDisposed = false;
    const listenerRegistration: { unlisten: (() => void) | null } = { unlisten: null };

    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void closeWindow().catch(() => undefined);
      })
      .then((removeListener) => {
        if (isDisposed) {
          removeListener();
          return;
        }
        listenerRegistration.unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Nao foi possivel interceptar o fechamento da popout.", error);
      });

    return () => {
      isDisposed = true;
      listenerRegistration.unlisten?.();
    };
  }, [closeWindow]);

  if (!documentId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 text-center text-sm text-status-red-text">
        Identificador do documento ausente.
      </div>
    );
  }

  return (
    <main className="flex h-screen min-h-0 flex-col bg-[var(--card)] text-[var(--foreground)]">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle pr-3">
        <nav className="flex h-full" aria-label="Conteudo do painel do Reader">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`px-5 text-[11px] font-bold uppercase tracking-[0.08em] outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                activeTab === tab.id ? "border-b-2 border-primary text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {errorMessage ? (
        <p className="shrink-0 border-b border-status-red/30 bg-status-red px-4 py-2 text-xs font-semibold text-status-red-text">
          {errorMessage}
        </p>
      ) : null}

      <section className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm font-semibold text-[var(--muted-foreground)]">Carregando...</div>
        ) : !documentDetails ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--muted-foreground)]">
            Informações do documento indisponíveis.
          </div>
        ) : activeTab === "annotations" ? (
          <AnnotationsTab
            document={documentDetails}
            annotations={annotations}
            currentPage={currentPage}
            databaseSource="preloaded"
            onJumpToPage={handleJumpToPage}
            onDelete={handleDeleteAnnotation}
            onUpdateNote={handleUpdateAnnotationNote}
            onOpenNotebook={requestOpenNotebook}
          />
        ) : (
          <AiTab />
        )}
      </section>
    </main>
  );
}
