import { Highlighter, Underline } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ContextMenu } from "../../../components/ui/ContextMenu";
import { ContextMenuItem } from "../../../components/ui/ContextMenuItem";
import { useContextMenu } from "../../../hooks/useContextMenu";
import {
  setDocumentAnnotationsFilterScope,
  type DatabaseHandleSource,
} from "../../../lib/database";
import type { Annotation } from "../../../types/annotation";
import type { AnnotationsFilterScope, LibraryDocument } from "../../../types/library";
import { highlightPalette } from "../highlightPalette";
import { MoreVerticalIcon } from "./readerPanelIcons";

type AnnotationsTabProps = {
  document: Pick<LibraryDocument, "id" | "annotationsFilterScope">;
  annotations: Annotation[];
  currentPage: number;
  databaseSource?: DatabaseHandleSource;
  onJumpToPage: (page: number, annotationId?: string) => void;
  onDelete: (annotationId: string) => void;
  onUpdateNote?: (annotationId: string, note: string) => Promise<void>;
};

type AnnotationCardProps = {
  annotation: Annotation;
  onJumpToPage: (page: number, annotationId?: string) => void;
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

function FilterIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />
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

function compareAnnotationPosition(first: Annotation, second: Annotation) {
  const firstY = first.rects.reduce((lowest, rect) => Math.min(lowest, rect.y), Number.POSITIVE_INFINITY);
  const secondY = second.rects.reduce((lowest, rect) => Math.min(lowest, rect.y), Number.POSITIVE_INFINITY);
  return first.page - second.page || firstY - secondY || first.createdAt.localeCompare(second.createdAt);
}

const filterScopeOptions: readonly { value: AnnotationsFilterScope; label: string }[] = [
  { value: "current_page", label: "Esta página" },
  { value: "all", label: "Todas as páginas" },
];

function AnnotationCard({ annotation, onJumpToPage, onDelete, onUpdateNote }: AnnotationCardProps) {
  const [note, setNote] = useState(annotation.note);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isQuoteExpanded, setIsQuoteExpanded] = useState(false);
  const [isQuoteTruncated, setIsQuoteTruncated] = useState(false);
  const quoteMeasureRef = useRef<HTMLQuoteElement | null>(null);
  const palette = highlightPalette[annotation.color];
  const canEdit = Boolean(onUpdateNote);
  const menu = useContextMenu();

  useEffect(() => {
    setNote(annotation.note);
  }, [annotation.note]);

  useEffect(() => {
    setIsQuoteExpanded(false);
  }, [annotation.id, annotation.selectedText]);

  useLayoutEffect(() => {
    const quoteMeasure = quoteMeasureRef.current;
    if (!quoteMeasure) {
      return;
    }
    const quoteMeasureElement = quoteMeasure;

    function updateQuoteTruncation() {
      setIsQuoteTruncated(quoteMeasureElement.scrollHeight > quoteMeasureElement.clientHeight);
    }

    updateQuoteTruncation();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(updateQuoteTruncation);
    resizeObserver.observe(quoteMeasureElement);

    return () => resizeObserver.disconnect();
  }, [annotation.selectedText]);

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
    <article className="group relative overflow-hidden rounded-lg border border-border-subtle bg-[var(--background)] transition hover:border-primary/70">
      <span
        data-annotation-color-stripe
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: palette.bg }}
        aria-hidden="true"
      />

      <header className="flex items-center gap-2 px-4 pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label={`Ir para a página ${annotation.page}`}
            title={`Ir para a página ${annotation.page}`}
            className="inline-flex shrink-0 items-center rounded-full border border-border-subtle bg-[var(--muted)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)] outline-none transition hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/60"
            onClick={() => onJumpToPage(annotation.page, annotation.id)}
          >
            p. {annotation.page}
          </button>
          <span
            role="img"
            aria-label={annotation.markStyle === "underline" ? "Sublinhado" : "Marca-texto"}
            title={annotation.markStyle === "underline" ? "Sublinhado" : "Marca-texto"}
            className="shrink-0 text-[var(--muted-foreground)]"
          >
            {annotation.markStyle === "underline" ? <Underline size={15} aria-hidden="true" /> : <Highlighter size={15} aria-hidden="true" />}
          </span>
        </div>
        <time dateTime={annotation.updatedAt} className="ml-auto truncate text-xs text-[var(--muted-foreground)]">
          {formatRelativeTime(annotation.updatedAt)}
        </time>
        <button
          type="button"
          aria-label="Opções da anotação"
          title="Opções da anotação"
          aria-haspopup="menu"
          aria-expanded={menu.isOpen}
          className="-mr-1.5 rounded-md p-1.5 text-[var(--muted-foreground)] opacity-0 outline-none transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary/60 group-hover:opacity-100 group-focus-within:opacity-100"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            menu.open(event);
          }}
        >
          <MoreVerticalIcon />
        </button>
        <ContextMenu isOpen={menu.isOpen} x={menu.x} y={menu.y} onClose={menu.close}>
          <ContextMenuItem
            icon={<JumpToPageIcon />}
            label={`Ir para a página ${annotation.page}`}
            onSelect={() => {
              menu.close();
              onJumpToPage(annotation.page, annotation.id);
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

      <div className="relative px-4 pt-3">
        <blockquote
          data-annotation-quote
          className={`font-serif text-sm italic leading-6 text-[var(--muted-foreground)] ${isQuoteExpanded ? "" : "line-clamp-3"}`}
        >
          “{annotation.selectedText}”
        </blockquote>

        <blockquote
          ref={quoteMeasureRef}
          data-annotation-quote-measure
          aria-hidden="true"
          className="pointer-events-none invisible absolute inset-x-4 top-3 line-clamp-3 font-serif text-sm italic leading-6"
        >
          “{annotation.selectedText}”
        </blockquote>

        {isQuoteTruncated ? (
          <button
            type="button"
            className="mt-1 text-xs font-semibold text-primary outline-none transition hover:text-primary-hover focus-visible:ring-2 focus-visible:ring-primary/60"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setIsQuoteExpanded((current) => !current);
            }}
          >
            {isQuoteExpanded ? "Mostrar menos" : "Mostrar mais"}
          </button>
        ) : null}
      </div>

      {canEdit ? (
        <textarea
          value={note}
          rows={2}
          placeholder="Escreva uma nota sobre este trecho..."
          disabled={isSaving}
          className="block w-full resize-none bg-transparent px-4 pt-2 font-sans text-sm font-normal leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:cursor-wait disabled:opacity-70"
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => void saveNote()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        />
      ) : annotation.note.trim().length > 0 ? (
        <p className="px-4 pt-2 font-sans text-sm font-normal leading-6 text-[var(--foreground)]">{annotation.note}</p>
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
  databaseSource = "loaded",
  onJumpToPage,
  onDelete,
  onUpdateNote,
}: AnnotationsTabProps) {
  const [filterScope, setFilterScope] = useState<AnnotationsFilterScope>(document.annotationsFilterScope);
  const currentPageAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.page === currentPage),
    [annotations, currentPage],
  );
  const scopedAnnotations = useMemo(() => {
    if (filterScope === "all") {
      return [...annotations].sort(compareAnnotationPosition);
    }
    return [...currentPageAnnotations].sort((first, second) => first.createdAt.localeCompare(second.createdAt));
  }, [annotations, currentPageAnnotations, filterScope]);

  useEffect(() => {
    setFilterScope(document.annotationsFilterScope);
  }, [document.annotationsFilterScope, document.id]);

  function handleFilterScopeToggle() {
    const nextScope: AnnotationsFilterScope = filterScope === "all" ? "current_page" : "all";
    setFilterScope(nextScope);
    void setDocumentAnnotationsFilterScope(document.id, nextScope, databaseSource).catch((error) => {
      console.warn("Não foi possível salvar o filtro de anotações do documento.", error);
    });
  }

  const emptyMessage = filterScope === "all" ? "Nenhuma anotação no documento." : "Nenhuma anotação nesta página.";
  const filterScopeToggleLabel = filterScope === "all"
    ? "Filtro de anotações: mostrando todas as páginas"
    : "Filtro de anotações: mostrando apenas a página atual";

  return (
    <div className="flex min-h-full flex-col px-4 py-5">
      <div className="space-y-6">
        <section>
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              aria-label={filterScopeToggleLabel}
              title={filterScopeToggleLabel}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-primary outline-none transition hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
              onClick={handleFilterScopeToggle}
            >
              <FilterIcon />
              <span>{filterScopeOptions.find((option) => option.value === filterScope)?.label}</span>
            </button>
          </div>

          {scopedAnnotations.length > 0 ? (
            <div className="mt-3 space-y-4">
              {scopedAnnotations.map((annotation) => (
                <AnnotationCard
                  key={annotation.id}
                  annotation={annotation}
                  onJumpToPage={onJumpToPage}
                  onDelete={onDelete}
                  onUpdateNote={onUpdateNote}
                />
              ))}
            </div>
          ) : (
            <div className="mt-3 flex flex-col items-center rounded-lg border border-dashed border-border-subtle px-6 py-8 text-center text-[var(--muted-foreground)]">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle">
                <EmptyIcon />
              </div>
              <p className="text-sm leading-6">{emptyMessage}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
