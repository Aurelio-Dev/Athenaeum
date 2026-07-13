import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { floatingPanelId, getCenteredPanelPosition, useFloatingPanels } from "../../components/floating/FloatingPanelsContext";
import { openDocumentExternally } from "../../lib/database";
import type { Annotation } from "../../types/annotation";
import type { LibraryDocument } from "../../types/library";
import { notebookPanelHeight, notebookPanelWidth } from "../notebooks/notebookPanelDimensions";
import { AnnotationsTab } from "./panels/AnnotationsTab";
import { DetailsTab } from "./panels/DetailsTab";

type ReaderTab = "details" | "annotations";

type ReaderSidePanelProps = {
  document: LibraryDocument;
  annotations: Annotation[];
  currentPage: number;
  progress: number;
  totalPages: number | null;
  fileSizeBytes: number | null;
  isFloating: boolean;
  initialTab?: ReaderTab;
  onFloat: () => void;
  onOpenSystemWindow: () => Promise<void>;
  onDock: () => void;
  onJumpToPage: (page: number) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onUpdateAnnotationNote: (annotationId: string, note: string) => Promise<void>;
  onToggleFavorite: () => Promise<void>;
  onClose: () => void;
};

const tabs: Array<{ id: ReaderTab; label: string }> = [
  { id: "details", label: "Detalhes" },
  { id: "annotations", label: "Anotações" },
];
const floatingPanelWidth = 440;
const floatingPanelHeight = 580;
const floatingPanelMinimizedHeight = 48;
const floatingPanelMinWidth = 320;
const floatingPanelMinHeight = 400;

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function PopOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3h7v7" />
      <path d="M10 14 21 3" />
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

export function ReaderSidePanel({
  document,
  annotations,
  currentPage,
  progress,
  totalPages,
  fileSizeBytes,
  isFloating,
  initialTab,
  onFloat,
  onOpenSystemWindow,
  onDock,
  onJumpToPage,
  onDeleteAnnotation,
  onUpdateAnnotationNote,
  onToggleFavorite,
  onClose,
}: ReaderSidePanelProps) {
  const [activeTab, setActiveTab] = useState<ReaderTab>(initialTab ?? "details");
  const { panels, openPanel, minimizePanel, restorePanel } = useFloatingPanels();
  const queryClient = useQueryClient();
  const annotationsPanelId = floatingPanelId("annotations", document.id);

  async function openSystemWindow() {
    try {
      await onOpenSystemWindow();
    } catch (error) {
      console.warn("Nao foi possivel abrir o painel em uma janela do sistema.", error);
    }
  }

  // Esc fecha o painel flutuante quando ele e o topo da pilha — mesma regra
  // dos paineis de caderno (o leitor, por sua vez, so fecha quando ELE e o
  // topo, entao um unico Esc nunca fecha os dois).
  useEffect(() => {
    if (!isFloating) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      const topPanel = panels[panels.length - 1];
      if (topPanel?.id === annotationsPanelId && !topPanel.isMinimized) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFloating, panels, annotationsPanelId, onClose]);

  // Handlers compartilhados pelas duas abas.
  function openNotebookPanel(notebookId: number) {
    const width = Math.min(notebookPanelWidth, window.innerWidth);
    const height = Math.min(notebookPanelHeight, window.innerHeight);
    openPanel("notebook", String(notebookId), getCenteredPanelPosition(width, height));
  }

  // Tags escritas direto no banco pelas abas: renova o snapshot da biblioteca
  // para o prop document refletir a mudanca.
  function handleTagsChanged() {
    void queryClient.invalidateQueries({ queryKey: ["library"] });
  }

  // Header de abas + conteudo sao os mesmos nos dois modos (dock/flutuante);
  // so a casca em volta muda.
  const panelContent = (
    <>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle pr-3">
        <div className="flex h-full">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`h-full px-5 text-[11px] font-bold uppercase tracking-[0.08em] outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                activeTab === tab.id ? "border-b-2 border-primary text-[var(--foreground)]" : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={isFloating ? "Ancorar painel" : "Abrir em janela separada"}
            title={isFloating ? "Ancorar painel" : "Abrir em janela separada"}
            className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={isFloating ? onDock : onFloat}
          >
            <PopOutIcon />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "annotations" ? (
          <AnnotationsTab
            document={document}
            annotations={annotations}
            currentPage={currentPage}
            progress={progress}
            onJumpToPage={onJumpToPage}
            onDelete={onDeleteAnnotation}
            onUpdateNote={onUpdateAnnotationNote}
            onOpenNotebook={openNotebookPanel}
            onTagsChanged={handleTagsChanged}
          />
        ) : (
          <DetailsTab
            document={document}
            progress={progress}
            totalPages={totalPages}
            fileSizeBytes={fileSizeBytes}
            onOpenNotebook={openNotebookPanel}
            onToggleFavorite={onToggleFavorite}
            onOpenExternally={() => openDocumentExternally(document.id)}
            onTagsChanged={handleTagsChanged}
          />
        )}
      </div>
    </>
  );

  if (isFloating) {
    const panel = panels.find((candidate) => candidate.id === annotationsPanelId);

    // Estado transitorio (painel acabou de ser fechado na pilha): nao ha o que
    // renderizar ate o ReaderModal reagir e voltar para o modo dock.
    if (!panel) {
      return null;
    }

    return (
      <FloatingPanelFrame
        panel={panel}
        width={floatingPanelWidth}
        height={panel.isMinimized ? floatingPanelMinimizedHeight : floatingPanelHeight}
        minWidth={floatingPanelMinWidth}
        minHeight={panel.isMinimized ? floatingPanelMinimizedHeight : floatingPanelMinHeight}
        resizable={!panel.isMinimized}
        title={<h2 className="min-w-0 truncate text-sm font-bold text-[var(--floating-header-text)]">Reader — {document.title}</h2>}
        actions={
          <>
            <button
              type="button"
              aria-label="Levar para janela do sistema"
              title="Levar para janela do sistema"
              className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                openSystemWindow();
              }}
            >
              <PopOutIcon />
            </button>
            <button
              type="button"
              aria-label={panel.isMinimized ? "Restaurar painel" : "Minimizar painel"}
              title={panel.isMinimized ? "Restaurar painel" : "Minimizar painel"}
              className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();

                if (panel.isMinimized) {
                  restorePanel(panel.id);
                  return;
                }

                minimizePanel(panel.id);
              }}
            >
              <MinimizeIcon />
            </button>
            <button
              type="button"
              aria-label="Fechar painel"
              title="Fechar painel"
              className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                onClose();
              }}
            >
              <CloseIcon />
            </button>
          </>
        }
      >
        {panel.isMinimized ? null : panelContent}
      </FloatingPanelFrame>
    );
  }

  return (
    <aside className="relative z-20 flex w-[320px] max-w-[calc(100vw-32px)] shrink-0 flex-col border-l border-border-subtle bg-[var(--card)]">
      {panelContent}
    </aside>
  );
}
