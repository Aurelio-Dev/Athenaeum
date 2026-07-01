import { useEffect, useState } from "react";
import type { Annotation } from "../../../types/annotation";
import { highlightPalette } from "../highlightPalette";

type AnnotationsTabProps = {
  annotations: Annotation[];
  onJumpToPage: (page: number) => void;
  onDelete: (annotationId: string) => void;
  onUpdateNote?: (annotationId: string, note: string) => Promise<void>;
};

type AnnotationCardProps = {
  annotation: Annotation;
  onJumpToPage: (page: number) => void;
  onDelete: (annotationId: string) => void;
  onUpdateNote?: (annotationId: string, note: string) => Promise<void>;
};

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
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

function transparentColor(hex: string) {
  return `${hex}26`;
}

function AnnotationCard({ annotation, onJumpToPage, onDelete, onUpdateNote }: AnnotationCardProps) {
  const [note, setNote] = useState(annotation.note);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const palette = highlightPalette[annotation.color];
  const canEdit = Boolean(onUpdateNote);

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
    <article className="group relative overflow-hidden rounded-lg border border-border-subtle bg-[var(--background)] transition hover:border-primary/70">
      <button type="button" className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/60" onClick={() => onJumpToPage(annotation.page)}>
        <blockquote
          className="border-l-[3px] px-4 py-4 text-sm italic leading-6 text-[var(--foreground)]"
          style={{ borderLeftColor: palette.bg, backgroundColor: transparentColor(palette.bg) }}
        >
          “{annotation.selectedText}”
        </blockquote>
      </button>

      {canEdit ? (
        <textarea
          value={note}
          rows={3}
          placeholder="Escreva uma nota sobre este trecho..."
          disabled={isSaving}
          className="block w-full resize-none bg-transparent px-4 pt-4 text-sm leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:cursor-wait disabled:opacity-70"
          onChange={(event) => setNote(event.target.value)}
          onBlur={() => void saveNote()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        />
      ) : annotation.note.trim().length > 0 ? (
        <p className="px-4 pt-4 text-sm leading-6 text-[var(--foreground)]">{annotation.note}</p>
      ) : null}

      {errorMessage.length > 0 ? <p className="px-4 pt-2 text-xs font-semibold text-status-red-text">{errorMessage}</p> : null}

      <footer className="px-4 pb-4 pt-4 text-xs text-[var(--muted-foreground)]">
        Página {annotation.page} · {formatRelativeTime(annotation.updatedAt)}
      </footer>

      <button
        type="button"
        aria-label="Remover anotação"
        title="Remover anotação"
        className="absolute right-3 top-3 rounded-md p-1.5 text-[var(--muted-foreground)] opacity-0 transition hover:bg-status-red hover:text-status-red-text focus:opacity-100 group-hover:opacity-100"
        onClick={() => onDelete(annotation.id)}
      >
        <TrashIcon />
      </button>
    </article>
  );
}

export function AnnotationsTab({ annotations, onJumpToPage, onDelete, onUpdateNote }: AnnotationsTabProps) {
  if (annotations.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-8 text-center text-[var(--muted-foreground)]">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-border-subtle">
          <EmptyIcon />
        </div>
        <p className="text-sm leading-6">Selecione um trecho do documento para criar uma anotação.</p>
      </div>
    );
  }

  const sortedAnnotations = [...annotations].sort(
    (first, second) => first.page - second.page || first.createdAt.localeCompare(second.createdAt),
  );

  return (
    <div className="space-y-4 px-4 py-5">
      {sortedAnnotations.map((annotation) => (
        <AnnotationCard key={annotation.id} annotation={annotation} onJumpToPage={onJumpToPage} onDelete={onDelete} onUpdateNote={onUpdateNote} />
      ))}
    </div>
  );
}
