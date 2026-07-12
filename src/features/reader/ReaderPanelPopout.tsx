import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteAnnotation,
  getDocumentNotes,
  isReaderInvalidationPayload,
  listAnnotations,
  READER_ANNOTATIONS_CHANGED_EVENT,
  READER_JUMP_TO_PAGE_EVENT,
  READER_NOTES_CHANGED_EVENT,
  setDocumentNote,
  updateAnnotationNote,
} from "../../lib/database";
import type { ReaderJumpToPagePayload } from "../../lib/database";
import type { Annotation } from "../../types/annotation";
import { AiTab } from "./panels/AiTab";
import { AnnotationsTab } from "./panels/AnnotationsTab";
import { NotesTab } from "./panels/NotesTab";

type ReaderPanelPopoutProps = {
  documentId: string;
};

type ReaderTab = "ai" | "notes" | "annotations";

const tabs: Array<{ id: ReaderTab; label: string }> = [
  { id: "ai", label: "Ask AI" },
  { id: "notes", label: "Notas" },
  { id: "annotations", label: "Anotações" },
];

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

export function ReaderPanelPopout({ documentId }: ReaderPanelPopoutProps) {
  const [activeTab, setActiveTab] = useState<ReaderTab>("ai");
  const [notesText, setNotesText] = useState("");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const notesSaveTimerRef = useRef<number | null>(null);
  const latestNotesRef = useRef("");
  const lastPersistedNotesRef = useRef("");
  const notesSavePromiseRef = useRef<Promise<void>>(Promise.resolve());
  const notesReloadSequenceRef = useRef(0);
  const annotationsReloadSequenceRef = useRef(0);

  const loadDocumentNotes = useCallback(() => getDocumentNotes(documentId, "preloaded"), [documentId]);
  const loadDocumentAnnotations = useCallback(() => listAnnotations(documentId, "preloaded"), [documentId]);

  const applyLoadedNotes = useCallback((notes: string) => {
    setNotesText(notes);
    latestNotesRef.current = notes;
    lastPersistedNotesRef.current = notes;
  }, []);

  useEffect(() => {
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

    Promise.all([loadDocumentNotes(), loadDocumentAnnotations()])
      .then(([notes, loadedAnnotations]) => {
        if (isCancelled) {
          return;
        }

        if (notesRequestSequence === notesReloadSequenceRef.current) {
          applyLoadedNotes(notes);
        }
        if (annotationsRequestSequence === annotationsReloadSequenceRef.current) {
          setAnnotations(loadedAnnotations);
        }
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
  }, [applyLoadedNotes, documentId, loadDocumentAnnotations, loadDocumentNotes]);

  useEffect(() => {
    let isDisposed = false;
    const unlistenCallbacks: Array<() => void> = [];
    const currentWindowLabel = getCurrentWebviewWindow().label;

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

    registerListener<unknown>(READER_NOTES_CHANGED_EVENT, (payload) => {
      if (
        !isReaderInvalidationPayload(payload) ||
        payload.documentId !== documentId ||
        payload.origin === currentWindowLabel
      ) {
        return;
      }

      const requestSequence = ++notesReloadSequenceRef.current;
      void loadDocumentNotes()
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
      void loadDocumentAnnotations()
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

    return () => {
      isDisposed = true;
      unlistenCallbacks.splice(0).forEach((unlisten) => unlisten());
    };
  }, [applyLoadedNotes, documentId, loadDocumentAnnotations, loadDocumentNotes]);

  const persistNotes = useCallback(
    (notes: string) => {
      if (notes === lastPersistedNotesRef.current) {
        return notesSavePromiseRef.current;
      }

      const savePromise = notesSavePromiseRef.current
        .catch(() => undefined)
        .then(() => setDocumentNote(documentId, notes, "preloaded"))
        .then(() => {
          lastPersistedNotesRef.current = notes;
          setErrorMessage("");
        });

      notesSavePromiseRef.current = savePromise;
      return savePromise;
    },
    [documentId],
  );

  const flushNotes = useCallback(async () => {
    if (notesSaveTimerRef.current !== null) {
      window.clearTimeout(notesSaveTimerRef.current);
      notesSaveTimerRef.current = null;
    }

    try {
      await persistNotes(latestNotesRef.current);
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
        void persistNotes(latestNotesRef.current).catch((error) => {
          console.warn("Nao foi possivel salvar as notas ao fechar a popout.", error);
        });
      }
    };
  }, [persistNotes]);

  function handleNotesChange(notes: string) {
    setNotesText(notes);
    latestNotesRef.current = notes;

    if (notesSaveTimerRef.current !== null) {
      window.clearTimeout(notesSaveTimerRef.current);
    }

    notesSaveTimerRef.current = window.setTimeout(() => {
      notesSaveTimerRef.current = null;
      void persistNotes(latestNotesRef.current).catch((error) => {
        console.warn("Nao foi possivel salvar as notas.", error);
        setErrorMessage("Nao foi possivel salvar as notas.");
      });
    }, 500);
  }

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

  function handleJumpToPage(page: number) {
    void emitTo<ReaderJumpToPagePayload>("main", READER_JUMP_TO_PAGE_EVENT, { documentId, page }).catch((error) => {
      console.warn("Nao foi possivel solicitar a navegacao para a pagina.", error);
    });
  }

  async function closeWindow() {
    try {
      await flushNotes();
      await getCurrentWindow().close();
    } catch {
      // O erro ja esta visivel; a janela fica aberta para permitir nova tentativa.
    }
  }

  if (!documentId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 text-center text-sm text-status-red-text">
        Identificador do documento ausente.
      </div>
    );
  }

  return (
    <main className="flex h-screen min-h-0 flex-col bg-[var(--card)] text-[var(--foreground)]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle pr-3">
        <nav className="flex h-full" aria-label="Conteudo do painel do Reader">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                activeTab === tab.id ? "border-b-2 border-primary text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <button
          type="button"
          aria-label="Fechar janela"
          title="Fechar janela"
          className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          onClick={() => void closeWindow()}
        >
          <CloseIcon />
        </button>
      </header>

      {errorMessage ? (
        <p className="shrink-0 border-b border-status-red/30 bg-status-red px-4 py-2 text-xs font-semibold text-status-red-text">
          {errorMessage}
        </p>
      ) : null}

      <section className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm font-semibold text-[var(--muted-foreground)]">Carregando...</div>
        ) : activeTab === "notes" ? (
          <NotesTab notesText={notesText} onNotesChange={handleNotesChange} onBlur={() => void flushNotes().catch(() => undefined)} />
        ) : activeTab === "annotations" ? (
          <AnnotationsTab
            annotations={annotations}
            onJumpToPage={handleJumpToPage}
            onDelete={handleDeleteAnnotation}
            onUpdateNote={handleUpdateAnnotationNote}
          />
        ) : (
          <AiTab />
        )}
      </section>
    </main>
  );
}
