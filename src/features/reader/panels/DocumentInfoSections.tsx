import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { CompactDocumentCard } from "../../../components/CompactDocumentCard";
import { ProgressBar } from "../../../components/ProgressBar";
import { TagBadge } from "../../../components/TagBadge";
import { ContextMenu } from "../../../components/ui/ContextMenu";
import { ContextMenuItem } from "../../../components/ui/ContextMenuItem";
import { useContextMenu } from "../../../hooks/useContextMenu";
import { TagSelector } from "../../library/TagSelector";
import {
  addDocumentTag,
  isReaderInvalidationPayload,
  listAvailableTags,
  listAvailableTagsFromPreloadedDatabase,
  listRelatedDocuments,
  openDocumentExternally,
  READER_DETAILS_CHANGED_EVENT,
  READER_OPEN_DOCUMENT_EVENT,
  removeDocumentTag,
  type DatabaseHandleSource,
  type ReaderDocumentPayload,
  type RelatedDocument,
} from "../../../lib/database";
import type { ReaderDocumentDetails, SubjectTag } from "../../../types/library";
import { statusTokens } from "../../../styles/designTokens";
import { BookOpenIcon, ExternalLinkIcon, MoreVerticalIcon } from "./readerPanelIcons";

// Secoes de informacao do documento compartilhadas entre as abas Detalhes e
// Anotacoes do painel do leitor (mesmo layout nas duas, conforme referencia).
// Cada secao e autossuficiente em dados quando precisa do banco, para poder
// ser montada tanto na janela principal quanto na popout.

export const sectionLabelClassName = "text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]";

export function formatFileSize(bytes: number | null) {
  if (bytes === null) {
    return "Indisponível";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)} ${units[unitIndex]}`;
}

export function formatReadingStatus(status: ReaderDocumentDetails["status"]) {
  return statusTokens[status].label;
}

// Recarrega dados da secao quando outra janela (ou outro componente) altera os
// detalhes deste documento. Sem filtro de origem: as secoes nao possuem estado
// proprio de edicao que um reload possa atropelar.
export function useReaderDetailsInvalidation(documentId: string, reload: () => void) {
  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    void listen<unknown>(READER_DETAILS_CHANGED_EVENT, (event) => {
      if (!isReaderInvalidationPayload(event.payload) || event.payload.documentId !== documentId) {
        return;
      }

      if (!isDisposed) {
        reload();
      }
    })
      .then((removeListener) => {
        if (isDisposed) {
          removeListener();
          return;
        }
        unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Não foi possível escutar as alterações dos detalhes.", error);
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [documentId, reload]);
}

type ReadingStatusCardProps = {
  status: ReaderDocumentDetails["status"];
  progress: number;
  variant?: "default" | "island";
};

export function ReadingStatusCard({ status, progress, variant = "default" }: ReadingStatusCardProps) {
  const normalizedProgress = Math.min(100, Math.max(0, Math.round(progress)));

  if (variant === "island") {
    return (
      <section aria-label="Status de leitura">
        <div className="flex items-center gap-2 rounded-full bg-[var(--muted)] px-3 py-2 text-xs font-semibold text-primary">
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-primary" />
          <span>{formatReadingStatus(status)}</span>
        </div>
        <div className="mt-3 flex items-center gap-4">
          <div className="min-w-0 flex-1">
            <ProgressBar value={normalizedProgress} showValue={false} />
          </div>
          <span className="min-w-10 text-right text-[15px] tabular-nums text-[var(--muted-foreground)]">{normalizedProgress}%</span>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className={sectionLabelClassName}>Status de leitura</h2>
      <div className="mt-3 rounded-lg border border-border-subtle bg-[var(--background)] px-3 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
            <span className="shrink-0 text-primary">
              <BookOpenIcon size={14} />
            </span>
            <span className="truncate">{formatReadingStatus(status)}</span>
          </span>
          <span className="shrink-0 text-xs tabular-nums text-[var(--muted-foreground)]">{normalizedProgress}%</span>
        </div>
        <ProgressBar value={normalizedProgress} showValue={false} />
      </div>
    </section>
  );
}

type DocumentTagsSectionProps = {
  documentId: string;
  tags: SubjectTag[];
  databaseSource?: DatabaseHandleSource;
  // Aviso ao host apos escrita confirmada, para ele renovar o proprio cache
  // (na main, invalidar as queries da biblioteca; na popout, reler o documento).
  onTagsChanged?: () => void;
};

export function DocumentTagsSection({ documentId, tags, databaseSource = "loaded", onTagsChanged }: DocumentTagsSectionProps) {
  const [localTags, setLocalTags] = useState<SubjectTag[]>(tags);
  const [availableTags, setAvailableTags] = useState<SubjectTag[]>([]);
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    setLocalTags(tags);
  }, [tags]);

  // Fecha o seletor em clique fora da secao (scroll nao fecha).
  useEffect(() => {
    if (!isSelectorOpen || !containerElement) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (containerElement && event.target instanceof Node && !containerElement.contains(event.target)) {
        setIsSelectorOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isSelectorOpen, containerElement]);

  async function toggleSelector() {
    if (isSelectorOpen) {
      setIsSelectorOpen(false);
      return;
    }

    try {
      const loadedTags =
        databaseSource === "preloaded" ? await listAvailableTagsFromPreloadedDatabase() : await listAvailableTags();
      setAvailableTags(loadedTags);
    } catch (error) {
      console.warn("Não foi possível carregar as tags disponíveis.", error);
      setAvailableTags(localTags);
    }

    setIsSelectorOpen(true);
  }

  // Recebe a lista completa desejada (do seletor ou do "×" de um chip),
  // persiste o diff e so entao confirma o estado local — falha reverte.
  async function applyTagsChange(nextTags: SubjectTag[]) {
    const addedTags = nextTags.filter((tag) => !localTags.includes(tag));
    const removedTags = localTags.filter((tag) => !nextTags.includes(tag));

    if (addedTags.length === 0 && removedTags.length === 0) {
      return;
    }

    const previousTags = localTags;
    setLocalTags(nextTags);
    setIsSaving(true);
    setErrorMessage("");

    try {
      for (const tag of addedTags) {
        await addDocumentTag(documentId, tag, databaseSource);
      }
      for (const tag of removedTags) {
        await removeDocumentTag(documentId, tag, databaseSource);
      }
      onTagsChanged?.();
    } catch (error) {
      console.warn("Não foi possível atualizar as tags.", error);
      setLocalTags(previousTags);
      setErrorMessage("Não foi possível atualizar as tags. Tente novamente.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section>
      <h2 className={sectionLabelClassName}>Tags</h2>
      <div ref={setContainerElement} className="relative mt-3">
        <div className={`flex flex-wrap items-center gap-1.5 ${isSaving ? "pointer-events-none opacity-60" : ""}`}>
          {localTags.map((tag) => (
            <TagBadge
              key={tag}
              tag={tag}
              size="compact"
              onRemove={() => void applyTagsChange(localTags.filter((currentTag) => currentTag !== tag))}
            />
          ))}
          <button
            type="button"
            aria-label="Adicionar tag"
            title="Adicionar tag"
            aria-expanded={isSelectorOpen}
            className="inline-flex items-center rounded-full border border-dashed border-border-subtle bg-[var(--muted)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted-foreground)] transition hover:border-primary hover:text-[var(--foreground)]"
            onClick={() => void toggleSelector()}
          >
            +
          </button>
        </div>

        {errorMessage ? <p className="mt-2 text-xs text-status-red-text">{errorMessage}</p> : null}

        {isSelectorOpen ? (
          <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border-subtle bg-[var(--card)] p-3 shadow-lg">
            <TagSelector
              availableTags={availableTags}
              selectedTags={localTags}
              onAvailableTagsChange={setAvailableTags}
              onSelectedTagsChange={(nextTags) => void applyTagsChange(nextTags)}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

type RelatedDocumentsSectionProps = {
  documentId: string;
  databaseSource?: DatabaseHandleSource;
};

export function RelatedDocumentsSection({ documentId, databaseSource = "loaded" }: RelatedDocumentsSectionProps) {
  const [relatedDocuments, setRelatedDocuments] = useState<RelatedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [menuTarget, setMenuTarget] = useState<RelatedDocument | null>(null);
  const menu = useContextMenu();

  useEffect(() => {
    let isCancelled = false;

    if (reloadToken === 0) {
      setRelatedDocuments([]);
      setIsLoading(true);
    }
    setErrorMessage("");

    void listRelatedDocuments(documentId, databaseSource)
      .then((documents) => {
        if (!isCancelled) {
          setRelatedDocuments(documents);
        }
      })
      .catch((error) => {
        console.warn("Não foi possível carregar os PDFs relacionados.", error);
        if (!isCancelled) {
          setErrorMessage("Não foi possível carregar os PDFs relacionados.");
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
  }, [databaseSource, documentId, reloadToken]);

  // Troca de documento reseta para o estado de carga cheia.
  useEffect(() => {
    setReloadToken(0);
  }, [documentId]);

  useReaderDetailsInvalidation(documentId, () => setReloadToken((current) => current + 1));

  function openMenu(event: ReactMouseEvent, target: RelatedDocument) {
    setMenuTarget(target);
    menu.open(event);
  }

  function openInReader() {
    if (!menuTarget) {
      return;
    }

    menu.close();
    // Sempre via evento para a janela principal: funciona igual da popout e da
    // propria main (o listener vive no LibraryView, fora do leitor).
    void emitTo<ReaderDocumentPayload>("main", READER_OPEN_DOCUMENT_EVENT, { documentId: menuTarget.id }).catch((error) => {
      console.warn("Não foi possível solicitar a abertura do documento.", error);
    });
  }

  function openExternally() {
    if (!menuTarget) {
      return;
    }

    menu.close();
    void openDocumentExternally(menuTarget.id).catch((error) => {
      console.warn("Não foi possível abrir o PDF externamente.", error);
      setErrorMessage("Não foi possível abrir o PDF externamente.");
    });
  }

  return (
    <section>
      <h2 className={sectionLabelClassName}>PDFs relacionados</h2>
      {isLoading ? (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">Carregando PDFs relacionados...</p>
      ) : errorMessage ? (
        <p className="mt-3 text-xs text-status-red-text">{errorMessage}</p>
      ) : relatedDocuments.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {relatedDocuments.map((relatedDocument) => (
            <li key={relatedDocument.id}>
              <CompactDocumentCard
                title={relatedDocument.title}
                authors={relatedDocument.authors}
                year={relatedDocument.year}
                trailingAction={
                  <button
                    type="button"
                    aria-label={`Mais opções de ${relatedDocument.title}`}
                    title="Mais opções"
                    aria-haspopup="menu"
                    aria-expanded={menu.isOpen && menuTarget?.id === relatedDocument.id}
                    className="rounded-md p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    onClick={(event) => openMenu(event, relatedDocument)}
                  >
                    <MoreVerticalIcon />
                  </button>
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">Nenhum PDF relacionado nesta coleção.</p>
      )}

      <ContextMenu isOpen={menu.isOpen} x={menu.x} y={menu.y} onClose={menu.close}>
        <ContextMenuItem icon={<BookOpenIcon />} label="Abrir no leitor" onSelect={openInReader} />
        <ContextMenuItem icon={<ExternalLinkIcon />} label="Abrir externamente" onSelect={openExternally} />
      </ContextMenu>
    </section>
  );
}

type DocumentInfoCondensedProps = {
  document: ReaderDocumentDetails;
};

// Bloco condensado da aba Anotacoes (referencia): rotulo sobre o valor, com
// Autor/disciplina e Ano lado a lado.
export function DocumentInfoCondensed({ document }: DocumentInfoCondensedProps) {
  const author = document.authors.length > 0 ? document.authors.join(", ") : "Sem autor";

  return (
    <section>
      <h2 className={sectionLabelClassName}>Informações do documento</h2>
      <dl className="mt-3 grid gap-3 text-xs">
        <div>
          <dt className="font-medium text-[var(--muted-foreground)]">Título</dt>
          <dd className="mt-0.5 min-w-0 break-words text-[var(--foreground)]">{document.title}</dd>
        </div>
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)] gap-3">
          <div>
            <dt className="font-medium text-[var(--muted-foreground)]">Autor / disciplina</dt>
            <dd className="mt-0.5 min-w-0 break-words text-[var(--foreground)]">{author}</dd>
          </div>
          <div>
            <dt className="font-medium text-[var(--muted-foreground)]">Ano</dt>
            <dd className="mt-0.5 text-[var(--foreground)]">{document.year}</dd>
          </div>
        </div>
      </dl>
    </section>
  );
}
