import { useEffect, useState } from "react";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { floatingPanelId, useFloatingPanels } from "../../components/floating/FloatingPanelsContext";
import type { Annotation } from "../../types/annotation";
import type { LibraryDocument, SubjectTag } from "../../types/library";
import { AiTab } from "./panels/AiTab";
import { AnnotationsTab } from "./panels/AnnotationsTab";
import { NotesTab } from "./panels/NotesTab";

type ReaderTab = "ai" | "notes" | "annotations";

type ReaderSidePanelProps = {
  document: LibraryDocument;
  notesText: string;
  onNotesChange: (notes: string) => void;
  onNotesBlur: () => void;
  availableTags: SubjectTag[];
  onAddTag: (tag: SubjectTag) => void;
  onRemoveTag: (tag: SubjectTag) => void;
  annotations: Annotation[];
  progress: number;
  timeSpentSeconds: number;
  isFloating: boolean;
  initialTab?: ReaderTab;
  onFloat: () => void;
  onDock: () => void;
  onJumpToPage: (page: number) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onUpdateAnnotationNote: (annotationId: string, note: string) => Promise<void>;
  onClose: () => void;
};

const tabs: Array<{ id: ReaderTab; label: string }> = [
  { id: "ai", label: "Ask AI" },
  { id: "notes", label: "Notas" },
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
  notesText,
  onNotesChange,
  onNotesBlur,
  annotations,
  isFloating,
  initialTab,
  onFloat,
  onDock,
  onJumpToPage,
  onDeleteAnnotation,
  onUpdateAnnotationNote,
  onClose,
}: ReaderSidePanelProps) {
  const [activeTab, setActiveTab] = useState<ReaderTab>(initialTab ?? "ai");
  const { panels, minimizePanel, restorePanel } = useFloatingPanels();
  const annotationsPanelId = floatingPanelId("annotations", document.id);

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

  // Header de abas + conteudo sao os mesmos nos dois modos (dock/flutuante);
  // so a casca em volta muda.
  const panelContent = (
    <>
      <header className="flex h-[56px] shrink-0 items-center justify-between border-b border-border-subtle pr-4">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`px-5 py-[18px] text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
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
        {activeTab === "notes" ? (
          <NotesTab notesText={notesText} onNotesChange={onNotesChange} onBlur={onNotesBlur} />
        ) : activeTab === "annotations" ? (
          <AnnotationsTab annotations={annotations} onJumpToPage={onJumpToPage} onDelete={onDeleteAnnotation} onUpdateNote={onUpdateAnnotationNote} />
        ) : (
          <AiTab />
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
        title={<h2 className="min-w-0 truncate text-sm font-bold text-[var(--floating-header-text)]">Anotações — {document.title}</h2>}
        actions={
          <>
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
    <aside className="relative z-20 flex w-[340px] max-w-[calc(100vw-32px)] shrink-0 flex-col border-l border-border-subtle bg-[var(--card)]">
      {panelContent}
    </aside>
  );
}
