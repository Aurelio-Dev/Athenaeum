import { useCallback, useEffect, useRef, useState } from "react";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { ContextMenuItem } from "../../components/ui/ContextMenuItem";
import { TrashIcon } from "../../components/ui/SharedIcons";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { useFloatingPanels, type FloatingPanel } from "../../components/floating/FloatingPanelsContext";
import { createNotebookPage, deleteNotebookPage, getNotebookInfo, listNotebookPages, saveNotebookPage, updateNotebookInfo, type NotebookInfo } from "../../lib/database";
import { useContextMenu } from "../../hooks/useContextMenu";
import type { LibraryCollection, NotebookPage } from "../../types/library";
import { NotebookPageEditor } from "./NotebookPageEditor";

const panelWidth = 520;
// Largura real exportada para o LibraryView informar a cascata da pilha
// (sem isso o fallback de 440px deixaria o painel transbordando a direita).
export const notebookPanelWidth = panelWidth;
const panelHeight = 620;
const panelMinWidth = 380;
const panelMinHeight = 440;
const contentInset = "pl-20";
// Altura do header do frame (h-10) + bordas: o painel minimizado vira so a
// barra de titulo arrastavel.
const collapsedHeight = 42;

function getMaximizedPanelSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function pageDisplayTitle(page: NotebookPage) {
  // Fallback calculado na UI a partir de position — nunca persistido.
  return page.title ?? `Página sem título ${page.position}`;
}

function NotebookHeaderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8.5 3v18" />
      <path d="M12 8h4.5" />
      <path d="M12 12h4.5" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="6" x2="18" y1="12" y2="12" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M8 20H4v-4" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4h12v12" />
      <path d="M4 8h12v12H4z" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <line x1="12" x2="12" y1="5" y2="19" />
      <line x1="5" x2="19" y1="12" y2="12" />
    </svg>
  );
}

function formatNotebookDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

type NotebookPanelProps = {
  panel: FloatingPanel;
  collections: LibraryCollection[];
  onClose: () => void;
  // Avisa a listagem (contagem de paginas / "Editado ha X") apos cada save.
  onNotebookChanged: () => void;
};

export function NotebookPanel({ panel, collections, onClose, onNotebookChanged }: NotebookPanelProps) {
  const notebookId = Number(panel.entityId);
  const { panels, movePanel } = useFloatingPanels();

  const [notebookTitle, setNotebookTitle] = useState("");
  const [pages, setPages] = useState<NotebookPage[]>([]);
  const [activePageId, setActivePageId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [contextPageId, setContextPageId] = useState<number | null>(null);
  const [panelSize, setPanelSize] = useState({ width: panelWidth, height: panelHeight });
  const [isMaximized, setIsMaximized] = useState(false);
  const [isRailExpanded, setIsRailExpanded] = useState(false);
  const pageContextMenu = useContextMenu();
  const [draftTitle, setDraftTitle] = useState("");
  const restoreStateRef = useRef<{
    position: { x: number; y: number };
    size: { width: number; height: number };
    collapsed: boolean;
  } | null>(null);
  const [notebookInfo, setNotebookInfo] = useState<NotebookInfo | null>(null);
  const [isInfoMenuOpen, setIsInfoMenuOpen] = useState(false);
  const [infoDraftTitle, setInfoDraftTitle] = useState("");
  const [infoDraftDescription, setInfoDraftDescription] = useState("");
  const [infoDraftCollectionId, setInfoDraftCollectionId] = useState("");
  const infoMenuRef = useRef<HTMLDivElement | null>(null);
  const infoDraftTitleRef = useRef("");
  const infoDraftDescriptionRef = useRef("");
  const infoDraftCollectionIdRef = useRef("");
  const isInfoDirtyRef = useRef(false);

  // Rascunho corrente fora do estado React: o conteudo muda a cada tecla e
  // re-renderizar o painel inteiro por tecla seria desperdicio — o autosave
  // le os refs no momento do save.
  const activePageIdRef = useRef<number | null>(null);
  const draftTitleRef = useRef("");
  const draftContentRef = useRef("");
  const isDirtyRef = useRef(false);
  const onNotebookChangedRef = useRef(onNotebookChanged);
  onNotebookChangedRef.current = onNotebookChanged;

  function setActivePageDrafts(page: NotebookPage) {
    setActivePageId(page.id);
    activePageIdRef.current = page.id;
    setDraftTitle(page.title ?? "");
    draftTitleRef.current = page.title ?? "";
    draftContentRef.current = page.content;
    isDirtyRef.current = false;
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [info, loadedPages] = await Promise.all([getNotebookInfo(notebookId), listNotebookPages(notebookId)]);
        // Caderno sem paginas (so possivel se o INSERT da primeira pagina
        // falhou na criacao): cria uma na hora para o editor ter onde focar.
        const ensuredPages = loadedPages.length > 0 ? loadedPages : [await createNotebookPage(notebookId)];

        if (cancelled) {
          return;
        }

        setNotebookInfo(info);
        setNotebookTitle(info.title);
        setInfoDraftTitle(info.title);
        setInfoDraftDescription(info.description);
        setInfoDraftCollectionId(info.collectionId);
        infoDraftTitleRef.current = info.title;
        infoDraftDescriptionRef.current = info.description;
        infoDraftCollectionIdRef.current = info.collectionId;
        isInfoDirtyRef.current = false;
        setPages(ensuredPages);
        setActivePageDrafts(ensuredPages[0]);
      } catch (error) {
        console.warn("Nao foi possivel carregar o caderno.", error);
        if (!cancelled) {
          setLoadError(true);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intencional: o painel carrega o caderno uma vez; trocar de caderno
    // significa outro painel (outra key na lista do LibraryView).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  const saveActivePage = useCallback(async () => {
    const pageId = activePageIdRef.current;

    if (!isDirtyRef.current || pageId === null) {
      return;
    }

    // Le os rascunhos SINCRONAMENTE antes de qualquer await: trocas de pagina
    // que acontecam durante o save nao contaminam o payload.
    const trimmedTitle = draftTitleRef.current.trim();
    const title = trimmedTitle.length > 0 ? trimmedTitle : null;
    const content = draftContentRef.current;
    isDirtyRef.current = false;

    try {
      await saveNotebookPage(pageId, { title, content });
      setPages((currentPages) => currentPages.map((page) => (page.id === pageId ? { ...page, title, content } : page)));
      setNotebookInfo((currentInfo) => (currentInfo ? { ...currentInfo, updatedAt: new Date().toISOString() } : currentInfo));
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel salvar a pagina do caderno.", error);
      isDirtyRef.current = true;
    }
  }, []);

  const saveNotebookInfoDraft = useCallback(async () => {
    if (!isInfoDirtyRef.current) {
      return;
    }

    const nextTitle = infoDraftTitleRef.current.trim() || "Caderno sem título";
    const nextDescription = infoDraftDescriptionRef.current;
    const nextCollectionId = infoDraftCollectionIdRef.current || notebookInfo?.collectionId || collections[0]?.id || "";

    if (!nextCollectionId) {
      return;
    }

    isInfoDirtyRef.current = false;

    try {
      const updatedInfo = await updateNotebookInfo(notebookId, {
        title: nextTitle,
        description: nextDescription,
        collectionId: nextCollectionId,
      });
      setNotebookInfo(updatedInfo);
      setNotebookTitle(updatedInfo.title);
      setInfoDraftTitle(updatedInfo.title);
      setInfoDraftDescription(updatedInfo.description);
      setInfoDraftCollectionId(updatedInfo.collectionId);
      infoDraftTitleRef.current = updatedInfo.title;
      infoDraftDescriptionRef.current = updatedInfo.description;
      infoDraftCollectionIdRef.current = updatedInfo.collectionId;
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel salvar as informacoes do caderno.", error);
      isInfoDirtyRef.current = true;
    }
  }, [collections, notebookId, notebookInfo?.collectionId]);

  async function switchToPage(pageId: number) {
    if (pageId === activePageIdRef.current) {
      return;
    }

    const nextPage = pages.find((page) => page.id === pageId);
    if (!nextPage) {
      return;
    }

    await saveActivePage();
    setActivePageDrafts(nextPage);
  }

  async function addPage() {
    await saveActivePage();

    try {
      const page = await createNotebookPage(notebookId);
      setPages((currentPages) => [...currentPages, page]);
      setNotebookInfo((currentInfo) => (currentInfo ? { ...currentInfo, updatedAt: page.createdAt } : currentInfo));
      setActivePageDrafts(page);
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel criar a pagina.", error);
    }
  }

  async function deleteContextPage() {
    const pageId = contextPageId;
    const page = pages.find((currentPage) => currentPage.id === pageId);

    pageContextMenu.close();

    if (!page) {
      return;
    }

    if (page.id !== activePageIdRef.current) {
      await saveActivePage();
    }

    try {
      await deleteNotebookPage(notebookId, page.id);

      let nextPages = await listNotebookPages(notebookId);
      if (nextPages.length === 0) {
        nextPages = [await createNotebookPage(notebookId)];
      }

      setPages(nextPages);

      const activePageStillExists = nextPages.some((nextPage) => nextPage.id === activePageIdRef.current);
      if (page.id === activePageIdRef.current || !activePageStillExists) {
        const nextActivePage = nextPages.find((nextPage) => nextPage.position >= page.position) ?? nextPages[nextPages.length - 1];
        setActivePageDrafts(nextActivePage);
      }

      setNotebookInfo((currentInfo) => (currentInfo ? { ...currentInfo, updatedAt: new Date().toISOString() } : currentInfo));
      onNotebookChangedRef.current();
    } catch (error) {
      console.warn("Nao foi possivel excluir a pagina do caderno.", error);
    }
  }

  const handleClose = useCallback(async () => {
    await saveNotebookInfoDraft();
    await saveActivePage();
    onClose();
  }, [saveNotebookInfoDraft, saveActivePage, onClose]);

  const toggleMaximized = useCallback(() => {
    if (isMaximized) {
      const restoreState = restoreStateRef.current;

      if (restoreState) {
        setPanelSize(restoreState.size);
        setIsCollapsed(restoreState.collapsed);
        movePanel(panel.id, restoreState.position);
      }

      setIsMaximized(false);
      return;
    }

    restoreStateRef.current = {
      position: panel.position,
      size: panelSize,
      collapsed: isCollapsed,
    };
    setIsCollapsed(false);
    setPanelSize(getMaximizedPanelSize());
    movePanel(panel.id, { x: 0, y: 0 });
    setIsMaximized(true);
  }, [isCollapsed, isMaximized, movePanel, panel.id, panel.position, panelSize]);

  useEffect(() => {
    if (!isMaximized) {
      return;
    }

    function handleWindowResize() {
      setPanelSize(getMaximizedPanelSize());
      movePanel(panel.id, { x: 0, y: 0 });
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isMaximized, movePanel, panel.id]);

  useEffect(() => {
    if (!isInfoMenuOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const target = event.target;

      if (target instanceof Node && infoMenuRef.current?.contains(target)) {
        return;
      }

      void saveNotebookInfoDraft();
      setIsInfoMenuOpen(false);
    }

    window.document.addEventListener("mousedown", handlePointerDown);
    return () => window.document.removeEventListener("mousedown", handlePointerDown);
  }, [isInfoMenuOpen, saveNotebookInfoDraft]);

  // Esc fecha o painel — mas so quando ele e o TOPO da pilha, para nao fechar
  // varios paineis com um unico Esc.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      const topPanel = panels[panels.length - 1];
      if (topPanel?.id === panel.id) {
        if (isInfoMenuOpen) {
          void saveNotebookInfoDraft();
          setIsInfoMenuOpen(false);
          return;
        }

        void handleClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [panels, panel.id, handleClose, isInfoMenuOpen, saveNotebookInfoDraft]);

  // Best-effort no unmount (ex.: app fechando o painel por outra via): salva
  // o que estiver sujo. saveActivePage e estavel (useCallback []), entao este
  // cleanup so roda no unmount real.
  useEffect(() => {
    return () => {
      void saveNotebookInfoDraft();
      void saveActivePage();
    };
  }, [saveNotebookInfoDraft, saveActivePage]);

  const activePage = pages.find((page) => page.id === activePageId) ?? null;

  return (
    <FloatingPanelFrame
      panel={panel}
      width={panelSize.width}
      height={isCollapsed ? collapsedHeight : panelSize.height}
      minWidth={panelMinWidth}
      minHeight={isCollapsed ? collapsedHeight : panelMinHeight}
      resizable={!isCollapsed && !isMaximized}
      edgeToEdge={isMaximized}
      renderHeader={(startDragging) => (
        <div
          className={`flex h-10 shrink-0 items-center justify-between border-b border-[var(--floating-header-border)] bg-[var(--floating-header-bg)] px-4 ${
            isMaximized ? "" : "cursor-move"
          }`}
          onMouseDown={isMaximized ? undefined : startDragging}
        >
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold text-[var(--floating-header-text)]">
            <span className="shrink-0 text-[var(--floating-header-muted)]">
              <NotebookHeaderIcon />
            </span>
            <span className="truncate">{notebookTitle || "Caderno"}</span>
          </h2>
          <div className="flex items-center gap-1" onMouseDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              aria-label={isCollapsed ? "Restaurar painel" : "Minimizar painel"}
              title={isCollapsed ? "Restaurar painel" : "Minimizar painel"}
              className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onClick={() => setIsCollapsed((current) => !current)}
            >
              <MinimizeIcon />
            </button>
            <button
              type="button"
              aria-label={isMaximized ? "Restaurar painel" : "Maximizar painel"}
              title={isMaximized ? "Restaurar painel" : "Maximizar painel"}
              className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onClick={toggleMaximized}
            >
              {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button
              type="button"
              aria-label="Fechar painel"
              title="Fechar painel"
              className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onClick={() => void handleClose()}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
    >
      {isCollapsed ? null : isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm font-semibold text-text-secondary">
          Carregando caderno
        </div>
      ) : loadError || !activePage ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm font-semibold text-status-red-text">
          Nao foi possivel carregar o caderno.
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col bg-[var(--card)]">
          {/* Rail flutuante de paginas: circulos numerados que expandem os
              titulos no hover da AREA do rail (nao so do circulo). */}
          <div
            className="absolute left-4 top-1/2 z-10 -translate-y-1/2"
            onMouseEnter={() => setIsRailExpanded(true)}
            onMouseLeave={() => setIsRailExpanded(false)}
          >
            <div className="flex flex-col gap-1">
              {pages.map((page) => (
                <div
                  key={page.id}
                  className="flex items-center"
                  onContextMenu={(event) => {
                    event.stopPropagation();
                    setContextPageId(page.id);
                    pageContextMenu.open(event);
                  }}
                >
                  <button
                    type="button"
                    title={pageDisplayTitle(page)}
                    aria-label={`Abrir ${pageDisplayTitle(page)}`}
                    aria-current={page.id === activePageId}
                    onClick={() => void switchToPage(page.id)}
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold opacity-70 shadow-sm transition hover:opacity-100 ${
                      page.id === activePageId
                        ? "bg-primary text-text-inverse"
                        : "bg-sidebar-raised text-text-primary hover:brightness-105"
                    }`}
                  >
                    {page.position}
                  </button>
                  <span
                    className={`overflow-hidden whitespace-nowrap rounded-md text-xs text-text-primary transition-all duration-150 ease-out ${
                      isRailExpanded ? "ml-2 max-w-[150px] bg-surface-muted px-2 py-1 opacity-100" : "ml-0 max-w-0 opacity-0"
                    }`}
                    aria-hidden={!isRailExpanded}
                  >
                    {pageDisplayTitle(page)}
                  </span>
                </div>
              ))}

              <button
                type="button"
                aria-label="Nova página"
                title="Nova página"
                onClick={() => void addPage()}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-raised text-text-secondary opacity-70 shadow-sm transition hover:text-text-primary hover:opacity-100 hover:brightness-105"
              >
                <PlusIcon />
              </button>
            </div>
          </div>

          <div className="relative flex shrink-0 items-start">
          <input
            value={draftTitle}
            onChange={(event) => {
              setDraftTitle(event.target.value);
              draftTitleRef.current = event.target.value;
              isDirtyRef.current = true;
            }}
            onBlur={() => void saveActivePage()}
            placeholder={`Página sem título ${activePage.position}`}
            aria-label="Título da página"
            className={`min-w-0 flex-1 border-0 bg-transparent pb-1 pr-5 pt-4 font-serif text-[26px] font-medium text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] ${contentInset}`}
          />

            <div ref={infoMenuRef} className="relative mr-5 mt-4 shrink-0">
              <button
                type="button"
                aria-label="Notebook info"
                title="Notebook info"
                aria-expanded={isInfoMenuOpen}
                className={`flex h-8 w-8 items-center justify-center rounded-full border transition ${
                  isInfoMenuOpen
                    ? "border-primary text-primary"
                    : "border-border-subtle text-text-secondary hover:border-primary hover:text-primary"
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (isInfoMenuOpen) {
                    void saveNotebookInfoDraft();
                  }

                  setIsInfoMenuOpen((isOpen) => !isOpen);
                }}
              >
                <MoreIcon />
              </button>

              {isInfoMenuOpen ? (
                <div className="absolute right-0 top-10 z-30 w-80 rounded-xl border border-border-subtle bg-[var(--card)] p-5 text-text-primary shadow-2xl">
                  <h3 className="truncate text-sm font-bold">{notebookInfo?.title || notebookTitle || "Caderno"}</h3>

                  <label className="mt-5 block text-xs font-bold text-text-secondary">
                    Título
                    <input
                      value={infoDraftTitle}
                      onChange={(event) => {
                        setInfoDraftTitle(event.target.value);
                        infoDraftTitleRef.current = event.target.value;
                        isInfoDirtyRef.current = true;
                      }}
                      onBlur={() => void saveNotebookInfoDraft()}
                      className="mt-2 h-10 w-full rounded-lg border border-border-subtle bg-transparent px-3 text-sm font-medium text-text-primary outline-none"
                      placeholder="Notebook Title"
                    />
                  </label>

                  <div className="mt-4 text-xs font-bold text-text-secondary">
                    Coleção
                    <select
                      value={infoDraftCollectionId}
                      onChange={(event) => {
                        setInfoDraftCollectionId(event.target.value);
                        infoDraftCollectionIdRef.current = event.target.value;
                        isInfoDirtyRef.current = true;
                        void saveNotebookInfoDraft();
                      }}
                      onBlur={() => void saveNotebookInfoDraft()}
                      className="mt-2 min-h-10 w-full appearance-none rounded-full border-0 bg-primary-soft px-4 py-2.5 text-sm font-medium text-text-primary outline-none"
                    >
                      {collections.map((collection) => (
                        <option key={collection.id} value={collection.id}>
                          {collection.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="mt-4 block text-xs font-bold text-text-secondary">
                    Descrição
                    <textarea
                      value={infoDraftDescription}
                      onChange={(event) => {
                        setInfoDraftDescription(event.target.value);
                        infoDraftDescriptionRef.current = event.target.value;
                        isInfoDirtyRef.current = true;
                      }}
                      onBlur={() => void saveNotebookInfoDraft()}
                      placeholder="Descreva seu caderno..."
                      className="mt-2 h-28 w-full resize-y rounded-lg border border-border-subtle bg-transparent px-3 py-3 text-sm font-normal text-text-primary outline-none placeholder:text-text-subtle"
                    />
                  </label>

                  <div className="mt-5 border-t border-dashed border-border-subtle pt-4 text-xs font-semibold leading-5 text-text-secondary">
                    <p>Criado em: {notebookInfo ? formatNotebookDate(notebookInfo.createdAt) : "--"}</p>
                    <p>Atualizado em: {notebookInfo ? formatNotebookDate(notebookInfo.updatedAt) : "--"}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <NotebookPageEditor
            key={activePage.id}
            initialContent={activePage.content}
            contentInsetClassName={contentInset}
            onContentChange={(html) => {
              draftContentRef.current = html;
              isDirtyRef.current = true;
            }}
            onBlur={() => void saveActivePage()}
          />
        </div>
      )}

      <ContextMenu isOpen={pageContextMenu.isOpen} x={pageContextMenu.x} y={pageContextMenu.y} onClose={pageContextMenu.close}>
        <ContextMenuItem
          icon={<TrashIcon size={16} />}
          label="Excluir permanentemente"
          variant="danger"
          onSelect={() => void deleteContextPage()}
        />
      </ContextMenu>
    </FloatingPanelFrame>
  );
}
