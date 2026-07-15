import { useCallback, useEffect, useRef, useState } from "react";
import { ContextMenu } from "../../../components/ui/ContextMenu";
import { ContextMenuItem } from "../../../components/ui/ContextMenuItem";
import { HeartIcon } from "../../../components/ui/SharedIcons";
import { useContextMenu } from "../../../hooks/useContextMenu";
import {
  getLatestLinkedNotebook,
  isOpenDocumentExternallyError,
  isReaderInvalidationPayload,
  linkDocumentToNotebook,
  listNotebookOptions,
  READER_DETAILS_CHANGED_EVENT,
  unlinkDocumentFromNotebook,
  type DatabaseHandleSource,
  type LatestLinkedNotebook,
  type NotebookOption,
} from "../../../lib/database";
import { listen } from "@tauri-apps/api/event";
import type { ReaderDocumentDetails } from "../../../types/library";
import {
  DocumentTagsSection,
  formatFileSize,
  ReadingStatusCard,
  RelatedDocumentsSection,
  sectionLabelClassName,
} from "./DocumentInfoSections";
import { BookOpenIcon, ExternalLinkIcon, MoreVerticalIcon, UnlinkIcon } from "./readerPanelIcons";

type DetailsTabProps = {
  document: ReaderDocumentDetails;
  progress: number;
  totalPages: number | null;
  fileSizeBytes: number | null;
  databaseSource?: DatabaseHandleSource;
  onOpenNotebook: (notebookId: number) => void;
  onToggleFavorite: () => Promise<void>;
  onOpenExternally: () => Promise<void>;
  showFooterActions?: boolean;
  // Renovacao de cache do host apos edicao de tags (ver DocumentTagsSection).
  onTagsChanged?: () => void;
};

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </svg>
  );
}

function formatAuthors(authors: string[]) {
  return authors.length > 0 ? authors.join(" · ") : "Sem autor informado";
}

function isSameCalendarDay(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function formatLastOpened(lastOpenedAt?: string) {
  if (!lastOpenedAt) {
    return "Nunca aberto";
  }

  const date = new Date(lastOpenedAt);
  if (Number.isNaN(date.getTime())) {
    return "Indisponível";
  }

  const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
  const now = new Date();

  if (isSameCalendarDay(date, now)) {
    return `hoje, ${time}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameCalendarDay(date, yesterday)) {
    return `ontem, ${time}`;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getActionErrorMessage(error: unknown, fallbackMessage: string) {
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  if (isOpenDocumentExternallyError(error) && error.message.trim().length > 0) {
    return error.message;
  }

  return fallbackMessage;
}

export function DetailsTab({
  document,
  progress,
  totalPages,
  fileSizeBytes,
  databaseSource = "loaded",
  onOpenNotebook,
  onToggleFavorite,
  onOpenExternally,
  showFooterActions = true,
  onTagsChanged,
}: DetailsTabProps) {
  const [linkedNotebook, setLinkedNotebook] = useState<LatestLinkedNotebook | null>(null);
  const [notebooks, setNotebooks] = useState<NotebookOption[]>([]);
  const [selectedNotebookId, setSelectedNotebookId] = useState<number | null>(null);
  const [isNotebookLoading, setIsNotebookLoading] = useState(true);
  const [notebookError, setNotebookError] = useState("");
  const [actionError, setActionError] = useState("");
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const [isOpeningExternally, setIsOpeningExternally] = useState(false);
  const latestDocumentIdRef = useRef(document.id);
  const notebookMenu = useContextMenu();
  const optionsMenu = useContextMenu();

  latestDocumentIdRef.current = document.id;

  const reloadLinkedNotebook = useCallback(
    (isCancelledRef?: { current: boolean }) => {
      void Promise.all([
        getLatestLinkedNotebook(document.id, databaseSource),
        listNotebookOptions(databaseSource),
      ])
        .then(([notebook, loadedNotebooks]) => {
          if (!isCancelledRef?.current) {
            setLinkedNotebook(notebook);
            setNotebooks(loadedNotebooks);
            setSelectedNotebookId((current) => {
              if (current !== null && loadedNotebooks.some((option) => option.id === current)) {
                return current;
              }

              return notebook?.id ?? loadedNotebooks[0]?.id ?? null;
            });
            setNotebookError("");
          }
        })
        .catch((error) => {
          console.warn("Não foi possível carregar o Caderno vinculado.", error);
          if (!isCancelledRef?.current) {
            setNotebookError("Não foi possível carregar o Caderno vinculado.");
          }
        })
        .finally(() => {
          if (!isCancelledRef?.current) {
            setIsNotebookLoading(false);
          }
        });
    },
    [databaseSource, document.id],
  );

  useEffect(() => {
    const isCancelledRef = { current: false };
    setLinkedNotebook(null);
    setNotebooks([]);
    setSelectedNotebookId(null);
    setIsNotebookLoading(true);
    setNotebookError("");
    setActionError("");
    setIsUnlinking(false);
    setIsLinking(false);
    setIsTogglingFavorite(false);
    setIsOpeningExternally(false);
    reloadLinkedNotebook(isCancelledRef);

    return () => {
      isCancelledRef.current = true;
    };
  }, [reloadLinkedNotebook]);

  useEffect(() => {
    if (!actionError) {
      return;
    }

    const timeoutId = window.setTimeout(() => setActionError(""), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [actionError]);

  useEffect(() => {
    const isCancelledRef = { current: false };
    let unlisten: (() => void) | null = null;

    void listen<unknown>(READER_DETAILS_CHANGED_EVENT, (event) => {
      if (!isReaderInvalidationPayload(event.payload) || event.payload.documentId !== document.id) {
        return;
      }

      reloadLinkedNotebook(isCancelledRef);
    })
      .then((removeListener) => {
        if (isCancelledRef.current) {
          removeListener();
          return;
        }
        unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Não foi possível escutar as alterações dos detalhes.", error);
      });

    return () => {
      isCancelledRef.current = true;
      unlisten?.();
    };
  }, [document.id, reloadLinkedNotebook]);

  async function handleLinkNotebook() {
    if (selectedNotebookId === null || isLinking) {
      return;
    }

    const documentId = document.id;
    const notebookId = selectedNotebookId;
    setActionError("");
    setIsLinking(true);

    try {
      await linkDocumentToNotebook(notebookId, documentId, databaseSource);
      const nextNotebook = await getLatestLinkedNotebook(documentId, databaseSource);
      if (latestDocumentIdRef.current === documentId) {
        setLinkedNotebook(nextNotebook);
      }
    } catch (error) {
      console.warn("Não foi possível vincular o Caderno.", error);
      if (latestDocumentIdRef.current === documentId) {
        setActionError("Não foi possível vincular o Caderno. Tente novamente.");
      }
    } finally {
      if (latestDocumentIdRef.current === documentId) {
        setIsLinking(false);
      }
    }
  }

  async function handleUnlinkNotebook() {
    if (!linkedNotebook || isUnlinking) {
      return;
    }

    const documentId = document.id;
    const notebookId = linkedNotebook.id;
    notebookMenu.close();
    setActionError("");
    setIsUnlinking(true);

    try {
      await unlinkDocumentFromNotebook(notebookId, documentId, databaseSource);
      const nextNotebook = await getLatestLinkedNotebook(documentId, databaseSource);
      if (latestDocumentIdRef.current === documentId) {
        setLinkedNotebook(nextNotebook);
      }
    } catch (error) {
      console.warn("Não foi possível desvincular o Caderno.", error);
      if (latestDocumentIdRef.current === documentId) {
        setActionError("Não foi possível desvincular o Caderno. Tente novamente.");
      }
    } finally {
      if (latestDocumentIdRef.current === documentId) {
        setIsUnlinking(false);
      }
    }
  }

  async function handleToggleFavorite() {
    optionsMenu.close();
    setActionError("");
    setIsTogglingFavorite(true);

    try {
      await onToggleFavorite();
    } catch (error) {
      console.warn("Não foi possível atualizar o favorito.", error);
      setActionError("Não foi possível atualizar o favorito. Tente novamente.");
    } finally {
      setIsTogglingFavorite(false);
    }
  }

  async function handleOpenExternally() {
    setActionError("");
    setIsOpeningExternally(true);

    try {
      await onOpenExternally();
    } catch (error) {
      console.warn("Não foi possível abrir o PDF externamente.", error);
      setActionError(
        getActionErrorMessage(
          error,
          "Não foi possível abrir o PDF externamente. Verifique o arquivo e tente novamente.",
        ),
      );
    } finally {
      setIsOpeningExternally(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col px-4 py-4">
      <div className="reader-island-sections">
        <section className="pb-5">
          <h2 className="font-serif text-[15.5px] font-bold leading-[1.35] text-[var(--foreground)]">
            {document.title}
          </h2>
          <p className="mt-2 text-[11px] leading-4 text-[var(--muted-foreground)]">
            {formatAuthors(document.authors)}
          </p>

          <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3.5 font-sans">
            <div className="min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--muted-foreground)]">Fonte</dt>
              <dd className="mt-0.5 truncate text-xs font-semibold text-[var(--foreground)]" title={document.source.trim() || "Não informada"}>
                {document.source.trim() || "Não informada"}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--muted-foreground)]">Ano</dt>
              <dd className="mt-0.5 text-xs font-semibold text-[var(--foreground)]">{document.year}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--muted-foreground)]">Páginas</dt>
              <dd className="mt-0.5 text-xs font-semibold text-[var(--foreground)]">{totalPages === null ? "Indisponível" : totalPages}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--muted-foreground)]">Tamanho</dt>
              <dd className="mt-0.5 text-xs font-semibold text-[var(--foreground)]">{formatFileSize(fileSizeBytes)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--muted-foreground)]">Última abertura</dt>
              <dd className="mt-0.5 text-xs font-semibold text-[var(--foreground)]">{formatLastOpened(document.lastOpenedAt)}</dd>
            </div>
          </dl>
        </section>

        <div className="py-5">
          <ReadingStatusCard status={document.status} progress={progress} variant="island" />
        </div>

        <section className="py-5">
          <h2 className={sectionLabelClassName}>Descrição</h2>
          <p className={`mt-3 whitespace-pre-wrap break-words text-xs leading-5 ${document.description.trim() ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
            {document.description.trim() || "Nenhuma descrição informada"}
          </p>
        </section>

        <div className="py-5">
          <DocumentTagsSection
            documentId={document.id}
            tags={document.tags}
            databaseSource={databaseSource}
            onTagsChanged={onTagsChanged}
          />
        </div>

        <section className="py-5">
          <h2 className={sectionLabelClassName}>Caderno vinculado</h2>
          {isNotebookLoading ? (
            <p className="mt-3 text-xs text-[var(--muted-foreground)]">Carregando Caderno vinculado...</p>
          ) : notebookError ? (
            <p className="mt-3 text-xs text-status-red-text">{notebookError}</p>
          ) : linkedNotebook ? (
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
              <div className="flex min-w-0 items-center gap-2 rounded-md border border-border-subtle bg-[var(--background)] px-2.5 py-2">
                <span className="shrink-0 text-primary"><BookOpenIcon size={14} /></span>
                <span className="truncate text-[11px] font-semibold text-[var(--foreground)]" title={linkedNotebook.title}>{linkedNotebook.title}</span>
              </div>
              <button
                type="button"
                className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border-subtle bg-[var(--card)] px-2.5 py-2 text-[11px] font-semibold text-primary transition hover:border-primary"
                onClick={() => onOpenNotebook(linkedNotebook.id)}
              >
                Abrir no Caderno
                <BookOpenIcon size={13} />
              </button>
              <button
                type="button"
                aria-label="Mais opções do Caderno vinculado"
                title="Mais opções"
                aria-haspopup="menu"
                aria-expanded={notebookMenu.isOpen}
                className="rounded-md border border-border-subtle p-2 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                onClick={notebookMenu.open}
              >
                <MoreVerticalIcon />
              </button>
              <ContextMenu isOpen={notebookMenu.isOpen} x={notebookMenu.x} y={notebookMenu.y} onClose={notebookMenu.close}>
                <ContextMenuItem
                  icon={<UnlinkIcon />}
                  label={isUnlinking ? "Desvinculando..." : "Desvincular"}
                  variant="danger"
                  disabled={isUnlinking}
                  onSelect={() => void handleUnlinkNotebook()}
                />
              </ContextMenu>
            </div>
          ) : notebooks.length > 0 ? (
            <div className="mt-3 space-y-2.5">
              <p className="text-xs leading-5 text-[var(--muted-foreground)]">Nenhum Caderno vinculado. Escolha um Caderno para continuar.</p>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                <select
                  aria-label="Selecionar Caderno para vincular"
                  value={selectedNotebookId ?? ""}
                  disabled={isLinking}
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
                  disabled={selectedNotebookId === null || isLinking}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border-subtle bg-[var(--card)] px-2.5 py-2 text-[11px] font-semibold text-primary transition hover:border-primary disabled:cursor-wait disabled:opacity-60"
                  onClick={() => void handleLinkNotebook()}
                >
                  <BookOpenIcon size={13} />
                  <span>{isLinking ? "Vinculando..." : "Vincular"}</span>
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs leading-5 text-[var(--muted-foreground)]">
              Nenhum Caderno disponível. Crie um Caderno na biblioteca para vincular este PDF.
            </p>
          )}
        </section>

        <div className="py-5">
          <RelatedDocumentsSection documentId={document.id} databaseSource={databaseSource} />
        </div>
      </div>

      {showFooterActions ? (
        <footer className="sticky bottom-0 -mx-4 border-t border-border-subtle bg-[var(--card)] px-4 pb-4 pt-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={optionsMenu.isOpen}
              className="inline-flex min-w-0 items-center justify-center gap-2 rounded-md border border-border-subtle bg-[var(--card)] px-2.5 py-2 text-[11px] font-semibold text-[var(--foreground)] transition hover:border-primary"
              onClick={optionsMenu.open}
            >
              <span>Mais opções</span>
              <MoreVerticalIcon />
            </button>
            <button
              type="button"
              disabled={isOpeningExternally}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-border-subtle bg-[var(--card)] px-2.5 py-2 text-[11px] font-semibold text-primary transition hover:border-primary disabled:cursor-wait disabled:opacity-60"
              onClick={() => void handleOpenExternally()}
            >
              <span>{isOpeningExternally ? "Abrindo..." : "Abrir original"}</span>
              <ExternalLinkIcon size={13} />
            </button>
          </div>
          <ContextMenu isOpen={optionsMenu.isOpen} x={optionsMenu.x} y={optionsMenu.y} onClose={optionsMenu.close}>
            <ContextMenuItem
              icon={<HeartIcon filled={document.favorite} size={16} />}
              label={isTogglingFavorite ? "Atualizando..." : document.favorite ? "Desfavoritar" : "Favoritar"}
              disabled={isTogglingFavorite}
              onSelect={() => void handleToggleFavorite()}
            />
          </ContextMenu>
        </footer>
      ) : null}

      {actionError ? (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-[10000] flex max-w-sm items-start gap-3 rounded-lg border border-status-red bg-status-red px-4 py-3 text-sm font-semibold text-status-red-text shadow-xl"
        >
          <span className="min-w-0 flex-1">{actionError}</span>
          <button
            type="button"
            aria-label="Fechar aviso"
            className="shrink-0 rounded p-0.5 transition hover:brightness-90"
            onClick={() => setActionError("")}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
}
