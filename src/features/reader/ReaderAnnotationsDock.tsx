import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { formatEditedAgo } from "../../lib/relativeTime";
import type { Annotation, AnnotationSaveState } from "../../types/annotation";
import { highlightPalette } from "./highlightPalette";

export type ReaderAnnotationsDockProps = {
  documentId: string;
  documentTitle: string;
  annotations: Annotation[];
  currentPage: number;
  visiblePages?: readonly number[];
  pendingSelection: { text: string } | null;
  saveStates: ReadonlyMap<string, AnnotationSaveState>;
  composerFocusSignal: number;
  onJumpToAnnotation: (annotation: Annotation) => void;
  onEdit: (annotation: Annotation) => void;
  onDelete: (annotationId: string) => void;
  onRetry: (annotationId: string) => void;
  onCreateNote: (note: string) => void;
  isPopoutOpen: boolean;
  onOpenPopout: () => Promise<void>;
};

function FilterIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function PopOutIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3h7v7" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1 2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
    </svg>
  );
}

function EmptyAnnotationIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

function formatRelativeTime(value: string) {
  const formattedValue = formatEditedAgo(value);
  const prefix = "Editado ";
  return formattedValue.startsWith(prefix) ? formattedValue.slice(prefix.length) : formattedValue;
}

function compareAnnotationPosition(first: Annotation, second: Annotation) {
  const firstY = first.rects.reduce((lowest, rect) => Math.min(lowest, rect.y), Number.POSITIVE_INFINITY);
  const secondY = second.rects.reduce((lowest, rect) => Math.min(lowest, rect.y), Number.POSITIVE_INFINITY);
  return first.page - second.page || firstY - secondY || first.createdAt.localeCompare(second.createdAt);
}

type AnnotationCardProps = {
  annotation: Annotation;
  saveState: AnnotationSaveState;
  onJumpToAnnotation: (annotation: Annotation) => void;
  onEdit: (annotation: Annotation) => void;
  onDelete: (annotationId: string) => void;
  onRetry: (annotationId: string) => void;
};

function AnnotationCard({ annotation, saveState, onJumpToAnnotation, onEdit, onDelete, onRetry }: AnnotationCardProps) {
  const palette = highlightPalette[annotation.color];

  function handleCardKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    onJumpToAnnotation(annotation);
  }

  return (
    <article
      role="button"
      tabIndex={0}
      title={`Ir para a anotação na página ${annotation.page}`}
      className="reader-annotation-border flex h-full cursor-pointer flex-col rounded-[11px] border bg-[var(--reader-annotation-card-bg)] px-3 py-2 outline-none transition hover:border-primary/70 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
      onClick={() => onJumpToAnnotation(annotation)}
      onKeyDown={handleCardKeyDown}
    >
      <blockquote
        className="line-clamp-2 border-l-2 pl-2.5 font-serif text-xs italic leading-[1.45] text-[var(--foreground)]"
        style={{ borderLeftColor: palette.bg }}
      >
        “{annotation.selectedText}”
      </blockquote>

      {annotation.note.trim().length > 0 ? (
        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-[1.45] text-[var(--foreground)]">{annotation.note}</p>
      ) : (
        <p className="mt-1.5 text-[11px] italic text-[var(--muted-foreground)]">Sem comentário</p>
      )}

      <footer className="mt-auto flex min-w-0 items-end justify-between gap-2 pt-1.5">
        <div className="min-w-0">
          <p className="truncate text-[10px] tabular-nums text-[var(--muted-foreground)]">
            página {annotation.page} · {formatRelativeTime(annotation.updatedAt)}
          </p>
          {saveState !== "saved" ? (
            <div role="status" aria-live="polite" aria-atomic="true" className="mt-0.5 text-[10px] font-semibold">
              {saveState === "saving" ? <span className="text-[var(--muted-foreground)]">Salvando…</span> : null}
              {saveState === "unsaved" ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-sm text-status-red-text outline-none transition hover:underline focus-visible:ring-2 focus-visible:ring-primary/60"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRetry(annotation.id);
                  }}
                >
                  <RetryIcon />
                  Tentar novamente
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            aria-label="Editar anotação"
            title={saveState === "saved" ? "Editar anotação" : "Aguarde a anotação ser salva."}
            disabled={saveState !== "saved"}
            className="rounded-md p-1.5 text-[var(--muted-foreground)] outline-none transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-[var(--muted-foreground)]"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(annotation);
            }}
          >
            <EditIcon />
          </button>
          <button
            type="button"
            aria-label="Excluir anotação"
            title={saveState === "saving" ? "Aguarde a anotação ser salva." : "Excluir anotação"}
            disabled={saveState === "saving"}
            className="rounded-md p-1.5 text-[var(--muted-foreground)] outline-none transition hover:bg-status-red hover:text-status-red-text focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-[var(--muted-foreground)]"
            onClick={(event) => {
              event.stopPropagation();
              onDelete(annotation.id);
            }}
          >
            <TrashIcon />
          </button>
        </div>
      </footer>
    </article>
  );
}

export function ReaderAnnotationsDock({
  documentId,
  documentTitle,
  annotations,
  currentPage,
  visiblePages,
  pendingSelection,
  saveStates,
  composerFocusSignal,
  onJumpToAnnotation,
  onEdit,
  onDelete,
  onRetry,
  onCreateNote,
  isPopoutOpen,
  onOpenPopout,
}: ReaderAnnotationsDockProps) {
  const [note, setNote] = useState("");
  const [composerFeedback, setComposerFeedback] = useState("");
  const [isOpeningPopout, setIsOpeningPopout] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastFocusSignalRef = useRef(composerFocusSignal);
  const feedbackId = useId();
  const pendingSelectionText = pendingSelection?.text ?? null;
  const hasPendingSelection = Boolean(pendingSelectionText?.trim());
  const effectiveVisiblePages = useMemo(
    () => (visiblePages && visiblePages.length > 0 ? [...visiblePages] : [currentPage]),
    [currentPage, visiblePages],
  );
  const visiblePageSet = useMemo(() => new Set(effectiveVisiblePages), [effectiveVisiblePages]);
  const pageAnnotations = useMemo(
    () =>
      annotations
        .filter((annotation) => visiblePageSet.has(annotation.page))
        .sort(compareAnnotationPosition),
    [annotations, visiblePageSet],
  );

  useEffect(() => {
    setNote("");
    setComposerFeedback(
      hasPendingSelection
        ? "Trecho selecionado. Escreva uma nota para criar a anotação."
        : "Selecione um trecho do PDF para habilitar a nova anotação.",
    );
  }, [hasPendingSelection, pendingSelection]);

  useEffect(() => {
    if (composerFocusSignal === lastFocusSignalRef.current) {
      return;
    }

    lastFocusSignalRef.current = composerFocusSignal;
    if (hasPendingSelection) {
      textareaRef.current?.focus();
    }
  }, [composerFocusSignal, hasPendingSelection]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedNote = note.trim();

    if (!hasPendingSelection || normalizedNote.length === 0) {
      return;
    }

    onCreateNote(normalizedNote);
    setNote("");
    setComposerFeedback("Anotação adicionada.");
  }

  async function handleOpenPopout() {
    if (isOpeningPopout) {
      return;
    }

    setIsOpeningPopout(true);
    try {
      await onOpenPopout();
    } catch (error) {
      console.warn("Nao foi possivel abrir a janela de Anotacoes.", error);
    } finally {
      setIsOpeningPopout(false);
    }
  }

  const isSpread = effectiveVisiblePages.length > 1;
  const pageLabel = isSpread
    ? `páginas ${effectiveVisiblePages[0]}–${effectiveVisiblePages[effectiveVisiblePages.length - 1]}`
    : `página ${effectiveVisiblePages[0] ?? currentPage}`;
  const annotationCountLabel = pageAnnotations.length === 1
    ? `1 marcação ${isSpread ? "nestas páginas" : "nesta página"}`
    : `${pageAnnotations.length} marcações ${isSpread ? "nestas páginas" : "nesta página"}`;
  const canSubmit = hasPendingSelection && note.trim().length > 0;

  return (
    <section
      aria-label={`Anotações: ${pageLabel}`}
      className="grid h-[158px] w-full grid-cols-[205px_minmax(0,1fr)_269px] overflow-hidden rounded-2xl border border-border-subtle bg-[var(--card)]"
      style={{ boxShadow: "var(--reader-dock-shadow)" }}
    >
      <header className="reader-annotation-border flex min-w-0 flex-col justify-center border-r px-[18px] py-4">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <h2 className="min-w-0 truncate font-serif text-base font-bold text-[var(--foreground)]">Anotações</h2>
          <button
            type="button"
            disabled={isOpeningPopout}
            aria-label={isPopoutOpen ? `Focar janela de Anotações aberta para ${documentTitle}` : `Abrir Anotações de ${documentTitle} em uma janela`}
            title={isPopoutOpen ? "Focar janela aberta" : "Abrir em janela"}
            data-reader-popout-document-id={documentId}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border-subtle bg-[var(--background)] px-2 text-[10px] font-semibold text-[var(--foreground)] outline-none transition hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-wait disabled:opacity-60"
            onClick={() => void handleOpenPopout()}
          >
            <PopOutIcon />
            {isOpeningPopout ? "Abrindo..." : isPopoutOpen ? "Focar" : "Abrir"}
          </button>
        </div>
        <p className="mt-1 truncate text-[11.5px] text-[var(--muted-foreground)]">{annotationCountLabel}</p>
        <span className="mt-2.5 inline-flex w-fit items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary">
          <FilterIcon />
          {pageLabel}
        </span>
      </header>

      {pageAnnotations.length > 0 ? (
        <ol className="flex min-w-0 gap-3 overflow-x-auto overflow-y-hidden px-4 py-3.5" aria-label={`Lista de anotações: ${pageLabel}`}>
          {pageAnnotations.map((annotation) => (
            <li key={annotation.id} className="h-full w-[278px] shrink-0">
              <AnnotationCard
                annotation={annotation}
                saveState={saveStates.get(annotation.id) ?? "saved"}
                onJumpToAnnotation={onJumpToAnnotation}
                onEdit={onEdit}
                onDelete={onDelete}
                onRetry={onRetry}
              />
            </li>
          ))}
        </ol>
      ) : (
        <div role="status" className="flex min-w-0 items-center justify-center gap-3 px-6 text-[var(--muted-foreground)]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-subtle">
            <EmptyAnnotationIcon />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--foreground)]">Nenhuma anotação {isSpread ? "nestas páginas" : "nesta página"}</p>
            <p className="mt-0.5 text-[11px]">Selecione um trecho do PDF para começar.</p>
          </div>
        </div>
      )}

      <form className="reader-annotation-border flex min-w-0 flex-col gap-2 border-l px-[18px] py-3" onSubmit={handleSubmit}>
        <label htmlFor={`${feedbackId}-note`} className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">
          Nova anotação
        </label>
        <textarea
          ref={textareaRef}
          id={`${feedbackId}-note`}
          value={note}
          rows={2}
          disabled={!hasPendingSelection}
          aria-describedby={feedbackId}
          placeholder="Selecione um trecho para anotar..."
          className="min-h-0 flex-1 resize-none rounded-lg border border-border-subtle bg-[var(--background)] px-2.5 py-2 text-xs leading-[1.4] text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted-foreground)] focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60"
          onChange={(event) => setNote(event.target.value)}
        />
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-text-inverse shadow-button outline-none transition hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon />
          Adicionar
        </button>
        <p id={feedbackId} aria-live="polite" aria-atomic="true" className="sr-only">
          {composerFeedback}
        </p>
      </form>
    </section>
  );
}
