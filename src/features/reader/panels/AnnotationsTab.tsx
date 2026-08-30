import { Highlighter, Underline } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { SVGProps } from "react";
import { EmptyState } from "../../../components/EmptyState";
import { ContextMenu } from "../../../components/ui/ContextMenu";
import { ContextMenuItem } from "../../../components/ui/ContextMenuItem";
import { SegmentedControl, type SegmentedOption } from "../../../components/ui/SegmentedControl";
import { ClearIcon, SearchIcon } from "../../../components/ui/SharedIcons";
import { useContextMenu } from "../../../hooks/useContextMenu";
import {
  getLatestLinkedNotebook,
  listNotebookOptions,
  setDocumentAnnotationsFilterScope,
  type DatabaseHandleSource,
  type LatestLinkedNotebook,
  type NotebookOption,
} from "../../../lib/database";
import { highlightColors, type Annotation, type HighlightColor } from "../../../types/annotation";
import type { AnnotationsFilterScope, LibraryDocument } from "../../../types/library";
import { highlightPalette } from "../highlightPalette";
import { sendReaderPageToNotebook } from "../sendPageToNotebook";
import { useReaderDetailsInvalidation } from "./DocumentInfoSections";
import { BookOpenIcon, MoreVerticalIcon, SendIcon } from "./readerPanelIcons";

type AnnotationsTabProps = {
  document: Pick<LibraryDocument, "id" | "title" | "annotationsFilterScope">;
  annotations: Annotation[];
  currentPage: number;
  databaseSource?: DatabaseHandleSource;
  onJumpToPage: (page: number, annotationId?: string) => void;
  onDelete: (annotationId: string) => void;
  onUpdateNote?: (annotationId: string, note: string) => Promise<void>;
  // Titulo junto: o Caderno abre como janela nativa (open_notebook_window
  // exige o titulo para a barra da janela).
  onOpenNotebook: (notebookId: number, notebookTitle: string) => void;
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

function JumpToPageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 14 20 9 15 4" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </svg>
  );
}

function EmptyAnnotationsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M11 5H30L37 12V43H11V5Z"
        stroke="var(--color-sidebar-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M30 5V12H37"
        stroke="var(--color-sidebar-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="17" y1="21" x2="31" y2="21" stroke="var(--color-empty-state-detail)" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="17" y1="26" x2="29" y2="26" stroke="var(--color-empty-state-detail)" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="17" y1="31" x2="25" y2="31" stroke="var(--color-empty-state-detail)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function EmptyFilteredAnnotationsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="20" cy="20" r="14" stroke="var(--color-sidebar-muted)" strokeWidth="2" />
      <line x1="30" y1="30" x2="43" y2="43" stroke="var(--color-sidebar-muted)" strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="16" x2="28" y2="16" stroke="var(--color-empty-state-detail)" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="20" x2="24" y2="20" stroke="var(--color-empty-state-detail)" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12" y1="24" x2="20" y2="24" stroke="var(--color-empty-state-detail)" strokeWidth="1.6" strokeLinecap="round" />
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

const filterScopeOptions: SegmentedOption<AnnotationsFilterScope>[] = [
  { value: "current_page", label: "Esta página" },
  { value: "all", label: "Todas" },
];

const highlightColorLabels: Record<HighlightColor, string> = {
  amber: "âmbar",
  violet: "violeta",
  indigo: "índigo",
  blue: "azul",
  teal: "verde-azulado",
  rose: "rosa",
};

function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

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
            className="inline-flex shrink-0 items-center rounded-full border border-border-subtle bg-[var(--muted)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--muted-foreground)] outline-none transition hover:border-primary hover:text-primary-text focus-visible:ring-2 focus-visible:ring-primary/60"
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
            className="mt-1 text-xs font-semibold text-primary-text outline-none transition hover:text-primary-text focus-visible:ring-2 focus-visible:ring-primary/60"
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
  onOpenNotebook,
}: AnnotationsTabProps) {
  const [filterScope, setFilterScope] = useState<AnnotationsFilterScope>(document.annotationsFilterScope);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedColors, setSelectedColors] = useState<Set<HighlightColor>>(() => new Set());
  const [notebooks, setNotebooks] = useState<NotebookOption[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(null);
  const [linkedNotebook, setLinkedNotebook] = useState<LatestLinkedNotebook | null>(null);
  const [isNotebooksLoading, setIsNotebooksLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [notebookFeedback, setNotebookFeedback] = useState("");
  const notebookLoadSequenceRef = useRef(0);
  const utilityMenu = useContextMenu();
  const usedHighlightColorCount = new Set(annotations.map((annotation) => annotation.color)).size;
  const showColorFilter = usedHighlightColorCount > 1;

  const visibleAnnotations = useMemo(() => {
    const normalizedTerm = normalizeSearchText(searchTerm.trim());
    const filtered = annotations.filter((annotation) => {
      const matchesScope = filterScope === "all" || annotation.page === currentPage;
      const matchesColor = selectedColors.size === 0 || selectedColors.has(annotation.color);
      const searchableText = normalizeSearchText(`${annotation.selectedText} ${annotation.note}`);
      const matchesSearch = normalizedTerm.length === 0 || searchableText.includes(normalizedTerm);
      return matchesScope && matchesColor && matchesSearch;
    });

    return filtered.sort(
      filterScope === "all"
        ? compareAnnotationPosition
        : (first, second) => first.createdAt.localeCompare(second.createdAt),
    );
  }, [annotations, currentPage, filterScope, searchTerm, selectedColors]);

  const reloadNotebooks = useCallback(() => {
    const requestSequence = ++notebookLoadSequenceRef.current;
    setIsNotebooksLoading(true);

    void Promise.all([
      listNotebookOptions(databaseSource),
      getLatestLinkedNotebook(document.id, databaseSource),
    ])
      .then(([loadedNotebooks, loadedLinkedNotebook]) => {
        if (requestSequence !== notebookLoadSequenceRef.current) {
          return;
        }

        setNotebooks(loadedNotebooks);
        setLinkedNotebook(loadedLinkedNotebook);
        setSelectedNotebookId((current) => {
          if (current !== null && loadedNotebooks.some((notebook) => notebook.id === current)) {
            return current;
          }
          return loadedLinkedNotebook?.id ?? loadedNotebooks[0]?.id ?? null;
        });
      })
      .catch((error) => {
        if (requestSequence !== notebookLoadSequenceRef.current) {
          return;
        }
        console.warn("Não foi possível carregar os Cadernos.", error);
        setNotebookFeedback("Não foi possível carregar os Cadernos.");
      })
      .finally(() => {
        if (requestSequence === notebookLoadSequenceRef.current) {
          setIsNotebooksLoading(false);
        }
      });
  }, [databaseSource, document.id]);

  useEffect(() => {
    setFilterScope(document.annotationsFilterScope);
  }, [document.annotationsFilterScope, document.id]);

  useEffect(() => {
    setSearchTerm("");
    setSelectedColors(new Set());
  }, [document.id]);

  useEffect(() => {
    setNotebooks([]);
    setSelectedNotebookId(null);
    setLinkedNotebook(null);
    setNotebookFeedback("");
    reloadNotebooks();
  }, [reloadNotebooks]);

  useReaderDetailsInvalidation(document.id, reloadNotebooks);

  function handleFilterScopeChange(nextScope: AnnotationsFilterScope) {
    if (nextScope === filterScope) {
      return;
    }

    setFilterScope(nextScope);
    void setDocumentAnnotationsFilterScope(document.id, nextScope, databaseSource).catch((error) => {
      console.warn("Não foi possível salvar o filtro de anotações do documento.", error);
    });
  }

  function handleClearFilters() {
    setSearchTerm("");
    setSelectedColors(new Set());
    handleFilterScopeChange("all");
  }

  function toggleColor(color: HighlightColor) {
    setSelectedColors((current) => {
      const next = new Set(current);
      if (next.has(color)) {
        next.delete(color);
      } else {
        next.add(color);
      }
      return next;
    });
  }

  async function handleSendCurrentPage() {
    const targetNotebook = notebooks.find((notebook) => notebook.id === selectedNotebookId);
    const hasCurrentPageAnnotations = annotations.some((annotation) => annotation.page === currentPage);
    if (!targetNotebook || !hasCurrentPageAnnotations || isSending) {
      return;
    }

    utilityMenu.close();
    setIsSending(true);
    setNotebookFeedback("");

    try {
      await sendReaderPageToNotebook({
        notebookId: targetNotebook.id,
        documentId: document.id,
        documentTitle: document.title,
        page: currentPage,
        databaseSource,
      });
      const notebookTitle = targetNotebook.title.trim() || "Caderno sem título";
      setNotebookFeedback(`Página ${currentPage} enviada para "${notebookTitle}".`);
    } catch (error) {
      console.warn("Não foi possível enviar a página para o Caderno.", error);
      setNotebookFeedback("Não foi possível enviar a página para o Caderno.");
    } finally {
      setIsSending(false);
    }
  }

  const trimmedSearchTerm = searchTerm.trim();
  const selectedColorLabels = highlightColors
    .filter((color) => selectedColors.has(color))
    .map((color) => highlightColorLabels[color]);
  const colorFilterDescription = selectedColorLabels.length === 1
    ? `cor ${selectedColorLabels[0]}`
    : selectedColorLabels.length > 1
      ? `cores ${selectedColorLabels.slice(0, -1).join(", ")} e ${selectedColorLabels[selectedColorLabels.length - 1]}`
      : null;
  const activeFilterDescriptions = [
    trimmedSearchTerm.length > 0 ? `"${trimmedSearchTerm}"` : null,
    colorFilterDescription,
    filterScope === "current_page" ? "esta página" : null,
  ].filter((description): description is string => description !== null);
  const filteredEmptyDescription = activeFilterDescriptions.length > 0
    ? `Nenhuma anotação corresponde a ${activeFilterDescriptions.join(" · ")}.`
    : "Nenhuma anotação corresponde aos filtros atuais.";
  const selectedNotebook = notebooks.find((notebook) => notebook.id === selectedNotebookId);
  const selectedNotebookTitle = selectedNotebook ? selectedNotebook.title.trim() || "Caderno sem título" : null;
  const linkedNotebookTitle = linkedNotebook ? linkedNotebook.title.trim() || "Caderno sem título" : null;
  const hasCurrentPageAnnotations = annotations.some((annotation) => annotation.page === currentPage);
  const sendPageLabel = selectedNotebookTitle
    ? `Enviar página ${currentPage} para "${selectedNotebookTitle}"`
    : `Enviar página ${currentPage} para o Caderno`;
  const sendPageDisabledTitle = isNotebooksLoading
    ? "Carregando Cadernos..."
    : notebooks.length === 0
      ? "Nenhum Caderno disponível. Crie um Caderno na biblioteca para enviar anotações."
      : !selectedNotebook
        ? "Nenhum Caderno disponível como destino."
        : !hasCurrentPageAnnotations
          ? "Nenhuma anotação nesta página para enviar."
          : isSending
            ? "Envio em andamento."
            : undefined;
  const pageGroups: Array<{ page: number; annotations: Annotation[] }> = [];

  if (filterScope === "all") {
    for (const annotation of visibleAnnotations) {
      const currentGroup = pageGroups[pageGroups.length - 1];
      if (!currentGroup || currentGroup.page !== annotation.page) {
        pageGroups.push({ page: annotation.page, annotations: [annotation] });
      } else {
        currentGroup.annotations.push(annotation);
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-border-subtle bg-[var(--card)]">
        <div className="flex h-11 items-center gap-2 px-3">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-subtle bg-[var(--background)] px-2.5 text-[var(--muted-foreground)] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
            <SearchIcon className="shrink-0" size={15} />
            <input
              value={searchTerm}
              type="text"
              inputMode="search"
              autoComplete="off"
              aria-label="Buscar anotações"
              placeholder="Buscar anotações..."
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
              onChange={(event) => setSearchTerm(event.target.value)}
            />
            {searchTerm.length > 0 ? (
              <button
                type="button"
                aria-label="Limpar busca de anotações"
                title="Limpar busca"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md outline-none transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-primary/60"
                onClick={() => setSearchTerm("")}
              >
                <ClearIcon size={14} />
              </button>
            ) : null}
          </label>

          <div className="shrink-0">
            <SegmentedControl
              options={filterScopeOptions}
              value={filterScope}
              onChange={handleFilterScopeChange}
              ariaLabel="Escopo das anotações"
            />
          </div>

          <button
            type="button"
            aria-label="Mais opções"
            title="Mais opções"
            aria-haspopup="menu"
            aria-expanded={utilityMenu.isOpen}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--muted-foreground)] outline-none transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-primary/60"
            onClick={utilityMenu.open}
          >
            <MoreVerticalIcon />
          </button>
          <ContextMenu isOpen={utilityMenu.isOpen} x={utilityMenu.x} y={utilityMenu.y} onClose={utilityMenu.close}>
            <ContextMenuItem
              icon={<SendIcon size={16} />}
              label={sendPageLabel}
              title={sendPageDisabledTitle ?? `Enviar as anotações da página ${currentPage} para "${selectedNotebookTitle}".`}
              disabled={sendPageDisabledTitle !== undefined}
              onSelect={() => void handleSendCurrentPage()}
            />
            <ContextMenuItem
              icon={<BookOpenIcon size={16} />}
              label="Abrir no Caderno"
              title={linkedNotebook === null ? "Nenhum Caderno vinculado a este documento." : `Abrir "${linkedNotebookTitle}".`}
              disabled={linkedNotebook === null}
              onSelect={() => {
                if (linkedNotebook && linkedNotebookTitle) {
                  utilityMenu.close();
                  onOpenNotebook(linkedNotebook.id, linkedNotebookTitle);
                }
              }}
            />
          </ContextMenu>
        </div>

        {showColorFilter ? (
          <div role="group" aria-label="Filtrar por cor de realce" className="flex h-8 items-center gap-2 border-t border-border-subtle px-3">
            {highlightColors.map((color) => {
              const isSelected = selectedColors.has(color);
              const colorLabel = highlightColorLabels[color];
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={`Filtrar pela cor ${colorLabel}`}
                  aria-pressed={isSelected}
                  title={`Cor ${colorLabel}`}
                  className={`h-4 w-4 rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] ${
                    isSelected ? "ring-2 ring-primary ring-offset-2 ring-offset-[var(--card)]" : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: highlightPalette[color].bg }}
                  onClick={() => toggleColor(color)}
                />
              );
            })}
          </div>
        ) : null}
      </div>

      <p role="status" aria-live="polite" className="sr-only">{notebookFeedback}</p>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <section className="h-full">
          {visibleAnnotations.length > 0 ? (
            filterScope === "all" ? (
              <div className="mt-3 space-y-5">
                {pageGroups.map((group) => (
                  <section key={group.page} aria-labelledby={`annotations-page-${group.page}`}>
                    <h2
                      id={`annotations-page-${group.page}`}
                      className="sticky top-0 z-10 bg-[var(--card)] py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]"
                    >
                      Página {group.page}
                    </h2>
                    <div className="mt-2 space-y-4">
                      {group.annotations.map((annotation) => (
                        <AnnotationCard
                          key={annotation.id}
                          annotation={annotation}
                          onJumpToPage={onJumpToPage}
                          onDelete={onDelete}
                          onUpdateNote={onUpdateNote}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            ) : (
              <div className="mt-3 space-y-4">
                {visibleAnnotations.map((annotation) => (
                  <AnnotationCard
                    key={annotation.id}
                    annotation={annotation}
                    onJumpToPage={onJumpToPage}
                    onDelete={onDelete}
                    onUpdateNote={onUpdateNote}
                  />
                ))}
              </div>
            )
          ) : annotations.length === 0 ? (
            <EmptyState
              icon={EmptyAnnotationsIcon}
              iconClassName="h-12 w-12"
              title="Nenhuma anotação ainda"
              description="Selecione um trecho de texto no PDF para criar uma anotação."
              verticalPosition="raised"
            />
          ) : (
            <EmptyState
              icon={EmptyFilteredAnnotationsIcon}
              iconClassName="h-12 w-12"
              title="Nenhuma anotação encontrada"
              description={filteredEmptyDescription}
              verticalPosition="raised"
              action={{ label: "Limpar filtros", onClick: handleClearFilters }}
            />
          )}
        </section>
      </div>
    </div>
  );
}
