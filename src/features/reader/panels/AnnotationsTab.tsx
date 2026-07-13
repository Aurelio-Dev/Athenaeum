import { useCallback, useEffect, useState } from "react";
import { ContextMenu } from "../../../components/ui/ContextMenu";
import { ContextMenuItem } from "../../../components/ui/ContextMenuItem";
import { useContextMenu } from "../../../hooks/useContextMenu";
import {
  getLatestLinkedNotebook,
  listNotebookOptions,
  openDocumentExternally,
  type DatabaseHandleSource,
  type NotebookOption,
} from "../../../lib/database";
import type { Annotation } from "../../../types/annotation";
import type { ReaderDocumentDetails } from "../../../types/library";
import { highlightPalette } from "../highlightPalette";
import { sendReaderPageToNotebook } from "../sendPageToNotebook";
import {
  DocumentInfoCondensed,
  DocumentTagsSection,
  ReadingStatusCard,
  RelatedDocumentsSection,
  sectionLabelClassName,
  useReaderDetailsInvalidation,
} from "./DocumentInfoSections";
import { BookOpenIcon, ExternalLinkIcon, MoreVerticalIcon, SendIcon } from "./readerPanelIcons";

type AnnotationsTabProps = {
  document: ReaderDocumentDetails;
  annotations: Annotation[];
  currentPage: number;
  progress: number;
  databaseSource?: DatabaseHandleSource;
  onJumpToPage: (page: number) => void;
  onDelete: (annotationId: string) => void;
  onUpdateNote?: (annotationId: string, note: string) => Promise<void>;
  onOpenNotebook: (notebookId: number) => void;
  onTagsChanged?: () => void;
};

type AnnotationCardProps = {
  annotation: Annotation;
  onJumpToPage: (page: number) => void;
  onDelete: (annotationId: string) => void;
  onUpdateNote?: (annotationId: string, note: string) => Promise<void>;
};

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.75 3.5H12.25" />
      <path d="M11.0833 3.5V11.6667C11.0833 12.25 10.5 12.8333 9.91667 12.8333H4.08333C3.5 12.8333 2.91667 12.25 2.91667 11.6667V3.5" />
      <path d="M4.66667 3.5V2.33334C4.66667 1.75 5.25 1.16667 5.83333 1.16667H8.16667C8.75 1.16667 9.33333 1.75 9.33333 2.33334V3.5" />
      <path d="M5.83333 6.41667V9.91667" />
      <path d="M8.16667 6.41667V9.91667" />
    </svg>
  );
}

function JumpToPageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 14 20 9 15 4" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </svg>
  );
}

function EmptyIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  const elapsedMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (!Number.isFinite(timestamp) || elapsedMs < minute) {
    return "agora";
  }
  if (elapsedMs < hour) {
    const minutes = Math.floor(elapsedMs / minute);
    return `há ${minutes} min`;
  }
  if (elapsedMs < day) {
    const hours = Math.floor(elapsedMs / hour);
    return `há ${hours} h`;
  }

  const days = Math.floor(elapsedMs / day);
  return days === 1 ? "ontem" : `há ${days} dias`;
}

function AnnotationCard({ annotation, onJumpToPage, onDelete, onUpdateNote }: AnnotationCardProps) {
  const [note, setNote] = useState(annotation.note);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const palette = highlightPalette[annotation.color];
  const canEdit = Boolean(onUpdateNote);
  const menu = useContextMenu();

  useEffect(() => {
    setNote(annotation.note);
  }, [annotation.note]);

  async function saveNote() {
    if (!onUpdateNote || note === annotation.note || isSaving) {
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      await onUpdateNote(annotation.id, note);
    } catch (error) {
      console.warn("Nao foi possivel salvar a nota.", error);
      setErrorMessage("Nao foi possivel salvar a nota.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-lg border border-border-subtle bg-[var(--background)] transition hover:border-primary/70">
      <header className="flex items-center justify-between gap-2 px-4 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          {/* Bolinha na cor do highlight: e o unico indicador de cor do card
              (a citacao nao e mais tingida, como na referencia). */}
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: palette.bg }} aria-hidden="true" />
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            <span className="font-semibold text-[var(--foreground)]">Você</span> · {formatRelativeTime(annotation.updatedAt)}
          </p>
        </div>
        <button
          type="button"
          aria-label="Opções da anotação"
          title="Opções da anotação"
          aria-haspopup="menu"
          aria-expanded={menu.isOpen}
          className="-mr-1.5 rounded-md p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          onClick={menu.open}
        >
          <MoreVerticalIcon />
        </button>
        <ContextMenu isOpen={menu.isOpen} x={menu.x} y={menu.y} onClose={menu.close}>
          <ContextMenuItem
            icon={<JumpToPageIcon />}
            label={`Ir para a página ${annotation.page}`}
            onSelect={() => {
              menu.close();
              onJumpToPage(annotation.page);
            }}
          />
          <ContextMenuItem
            icon={<TrashIcon />}
            label="Excluir"
            variant="danger"
            onSelect={() => {
              menu.close();
              onDelete(annotation.id);
            }}
          />
        </ContextMenu>
      </header>

      <button
        type="button"
        className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        title={`Ir para a página ${annotation.page}`}
        onClick={() => onJumpToPage(annotation.page)}
      >
        <blockquote className="px-4 pt-2 text-sm italic leading-6 text-[var(--foreground)]">
          “{annotation.selectedText}”
        </blockquote>
      </button>

      {canEdit ? (
        <textarea
          value={note}
          rows={2}
          placeholder="Escreva uma nota sobre este trecho..."
          disabled={isSaving}
          className="block w-full resize-none bg-transparent px-4 pt-2 text-sm leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:cursor-wait disabled:opacity-70"
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => void saveNote()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        />
      ) : annotation.note.trim().length > 0 ? (
        <p className="px-4 pt-2 text-sm leading-6 text-[var(--foreground)]">{annotation.note}</p>
      ) : null}

      {errorMessage.length > 0 ? <p className="px-4 pt-2 text-xs font-semibold text-status-red-text">{errorMessage}</p> : null}

      {/* Respiro inferior constante, independente de qual bloco e o ultimo. */}
      <div className="h-3" aria-hidden="true" />
    </article>
  );
}

export function AnnotationsTab({
  document,
  annotations,
  currentPage,
  progress,
  databaseSource = "loaded",
  onJumpToPage,
  onDelete,
  onUpdateNote,
  onOpenNotebook,
  onTagsChanged,
}: AnnotationsTabProps) {
  const [showCreateHint, setShowCreateHint] = useState(false);
  const [notebooks, setNotebooks] = useState<NotebookOption[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(null);
  const [linkedNotebookId, setLinkedNotebookId] = useState<number | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendFeedback, setSendFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const footerMenu = useContextMenu();
  const pageAnnotations = annotations
    .filter((annotation) => annotation.page === currentPage)
    .sort((first, second) => first.createdAt.localeCompare(second.createdAt));

  useEffect(() => {
    setShowCreateHint(false);
  }, [currentPage]);

  useEffect(() => {
    if (!showCreateHint) {
      return;
    }

    const timer = window.setTimeout(() => setShowCreateHint(false), 5000);
    return () => window.clearTimeout(timer);
  }, [showCreateHint]);

  useEffect(() => {
    if (!sendFeedback || sendFeedback.type !== "success") {
      return;
    }

    const timer = window.setTimeout(() => setSendFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [sendFeedback]);

  // Cadernos disponiveis + caderno vinculado (pre-selecionado no envio e alvo
  // do botao "Abrir no Caderno" do rodape).
  const reloadNotebooks = useCallback(() => {
    void Promise.all([
      listNotebookOptions(databaseSource),
      getLatestLinkedNotebook(document.id, databaseSource),
    ])
      .then(([loadedNotebooks, linkedNotebook]) => {
        setNotebooks(loadedNotebooks);
        setLinkedNotebookId(linkedNotebook?.id ?? null);
        setSelectedNotebookId((current) => {
          if (current !== null && loadedNotebooks.some((notebook) => notebook.id === current)) {
            return current;
          }
          return linkedNotebook?.id ?? loadedNotebooks[0]?.id ?? null;
        });
      })
      .catch((error) => {
        console.warn("Não foi possível carregar os Cadernos.", error);
      });
  }, [databaseSource, document.id]);

  useEffect(() => {
    setNotebooks([]);
    setSelectedNotebookId(null);
    setLinkedNotebookId(null);
    setSendFeedback(null);
    reloadNotebooks();
  }, [reloadNotebooks]);

  useReaderDetailsInvalidation(document.id, reloadNotebooks);

  async function handleSendPage() {
    if (selectedNotebookId === null || isSending) {
      return;
    }

    setIsSending(true);
    setSendFeedback(null);

    try {
      await sendReaderPageToNotebook({
        notebookId: selectedNotebookId,
        documentId: document.id,
        documentTitle: document.title,
        page: currentPage,
        databaseSource,
      });
      setSendFeedback({ type: "success", message: `Página ${currentPage} enviada para o Caderno.` });
    } catch (error) {
      console.warn("Não foi possível enviar a página para o Caderno.", error);
      setSendFeedback({ type: "error", message: "Não foi possível enviar para o Caderno. Tente novamente." });
    } finally {
      setIsSending(false);
    }
  }

  function handleOpenExternally() {
    footerMenu.close();
    void openDocumentExternally(document.id).catch((error) => {
      console.warn("Não foi possível abrir o PDF externamente.", error);
    });
  }

  const canSend = notebooks.length > 0 && selectedNotebookId !== null && pageAnnotations.length > 0 && !isSending;

  return (
    <div className="flex min-h-full flex-col px-4 py-5">
      <div className="space-y-6">
        <div>
          <button
            type="button"
            title="Selecione um trecho do PDF para criar uma anotação."
            className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-bold text-white shadow-button transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            onClick={() => setShowCreateHint(true)}
          >
            + Criar anotação
          </button>

          {showCreateHint ? (
            <p role="status" className="mt-2 rounded-lg border border-border-subtle bg-[var(--muted)] px-3 py-2 text-xs leading-5 text-[var(--muted-foreground)]">
              Selecione um trecho de texto no PDF. A barra de anotação aparecerá junto à seleção.
            </p>
          ) : null}
        </div>

        <section>
          <h2 className={sectionLabelClassName}>Anotações na página {currentPage}</h2>

          {pageAnnotations.length > 0 ? (
            <div className="mt-3 space-y-4">
              {pageAnnotations.map((annotation) => (
                <AnnotationCard key={annotation.id} annotation={annotation} onJumpToPage={onJumpToPage} onDelete={onDelete} onUpdateNote={onUpdateNote} />
              ))}
            </div>
          ) : (
            <div className="mt-3 flex flex-col items-center rounded-lg border border-dashed border-border-subtle px-6 py-8 text-center text-[var(--muted-foreground)]">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle">
                <EmptyIcon />
              </div>
              <p className="text-sm leading-6">Nenhuma anotação nesta página.</p>
            </div>
          )}
        </section>

        <section className="border-t border-border-subtle pt-5">
          <h2 className={sectionLabelClassName}>Enviar para Caderno</h2>
          {notebooks.length > 0 ? (
            <>
              <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <select
                  aria-label="Selecionar Caderno"
                  value={selectedNotebookId ?? ""}
                  disabled={isSending}
                  className="w-full min-w-0 rounded-md border border-border-subtle bg-[var(--card)] px-2.5 py-2 text-[11px] font-semibold text-[var(--foreground)] outline-none transition hover:border-primary focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-wait disabled:opacity-60"
                  onChange={(event) => setSelectedNotebookId(Number(event.target.value))}
                >
                  {notebooks.map((notebook) => (
                    <option key={notebook.id} value={notebook.id}>
                      {notebook.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!canSend}
                  title={pageAnnotations.length === 0 ? "Crie uma anotação nesta página para enviar." : undefined}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border-subtle bg-[var(--card)] px-2.5 py-2 text-[11px] font-semibold text-primary transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void handleSendPage()}
                >
                  <SendIcon size={13} />
                  <span>{isSending ? "Enviando..." : `Enviar página ${currentPage}`}</span>
                </button>
              </div>
              {sendFeedback ? (
                <p
                  role="status"
                  className={`mt-2 text-xs font-semibold ${sendFeedback.type === "success" ? "text-primary" : "text-status-red-text"}`}
                >
                  {sendFeedback.message}
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">Nenhum Caderno disponível. Crie um Caderno na biblioteca para enviar anotações.</p>
          )}
        </section>

        <DocumentInfoCondensed document={document} />

        <DocumentTagsSection
          documentId={document.id}
          tags={document.tags}
          databaseSource={databaseSource}
          onTagsChanged={onTagsChanged}
        />

        <ReadingStatusCard status={document.status} progress={progress} />

        <RelatedDocumentsSection documentId={document.id} databaseSource={databaseSource} />
      </div>

      <footer className="sticky bottom-0 -mx-4 mt-6 border-t border-border-subtle bg-[var(--card)] px-4 pb-4 pt-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <button
            type="button"
            disabled={linkedNotebookId === null}
            title={linkedNotebookId === null ? "Nenhum Caderno vinculado a este documento." : undefined}
            className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md border border-border-subtle bg-[var(--card)] px-2.5 py-2 text-[11px] font-semibold text-primary transition hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => {
              if (linkedNotebookId !== null) {
                onOpenNotebook(linkedNotebookId);
              }
            }}
          >
            <BookOpenIcon size={13} />
            <span>Abrir no Caderno</span>
          </button>
          <button
            type="button"
            aria-label="Mais opções"
            title="Mais opções"
            aria-haspopup="menu"
            aria-expanded={footerMenu.isOpen}
            className="rounded-md border border-border-subtle p-2 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={footerMenu.open}
          >
            <MoreVerticalIcon />
          </button>
        </div>
        <ContextMenu isOpen={footerMenu.isOpen} x={footerMenu.x} y={footerMenu.y} onClose={footerMenu.close}>
          <ContextMenuItem icon={<ExternalLinkIcon />} label="Abrir externamente" onSelect={handleOpenExternally} />
        </ContextMenu>
      </footer>
    </div>
  );
}
