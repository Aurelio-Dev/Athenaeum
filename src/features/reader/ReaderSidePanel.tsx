import { useState, type MouseEvent } from "react";
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
const floatingPanelMinWidth = 320;
const floatingPanelMinHeight = 400;
const floatingPanelTop = 94;

function getInitialFloatingPosition() {
  return {
    x: Math.max(8, Math.min(window.innerWidth - floatingPanelWidth, window.innerWidth - floatingPanelWidth - 24)),
    y: Math.max(76, Math.min(floatingPanelTop, window.innerHeight - floatingPanelHeight)),
  };
}

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

export function ReaderSidePanel({
  document,
  notesText,
  onNotesChange,
  onNotesBlur,
  availableTags,
  onAddTag,
  onRemoveTag,
  annotations,
  progress,
  timeSpentSeconds,
  isFloating,
  onFloat,
  onDock,
  onJumpToPage,
  onDeleteAnnotation,
  onUpdateAnnotationNote,
  onClose,
}: ReaderSidePanelProps) {
  const [activeTab, setActiveTab] = useState<ReaderTab>("ai");
  const [floatingPosition, setFloatingPosition] = useState(getInitialFloatingPosition);

  function floatPanel() {
    setFloatingPosition(getInitialFloatingPosition());
    onFloat();
  }

  function startDragging(event: MouseEvent<HTMLElement>) {
    if (!isFloating || event.button !== 0) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const initialPosition = floatingPosition;

    function handleMouseMove(moveEvent: globalThis.MouseEvent) {
      setFloatingPosition({
        x: Math.max(8, initialPosition.x + moveEvent.clientX - startX),
        y: Math.max(76, initialPosition.y + moveEvent.clientY - startY),
      });
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  const panelClassName = isFloating
    ? "fixed z-40 flex resize flex-col overflow-hidden rounded-xl border border-border-subtle bg-[var(--card)] shadow-2xl"
    : "relative z-20 flex w-[340px] max-w-[calc(100vw-32px)] shrink-0 flex-col border-l border-border-subtle bg-[var(--card)]";
  const panelStyle = isFloating
    ? {
        left: floatingPosition.x,
        top: floatingPosition.y,
        width: floatingPanelWidth,
        height: floatingPanelHeight,
        minWidth: floatingPanelMinWidth,
        minHeight: floatingPanelMinHeight,
      }
    : undefined;

  return (
    <aside className={panelClassName} style={panelStyle}>
      {isFloating ? (
        <div
          className="flex h-11 shrink-0 items-center justify-between rounded-t-xl bg-[var(--surface-header)] px-4 cursor-move"
          onMouseDown={startDragging}
        >
          <h2 className="min-w-0 truncate text-sm font-bold text-white">
            Anotações — {document.title}
          </h2>
          <button
            type="button"
            aria-label="Fechar painel"
            title="Fechar painel"
            className="rounded-md p-1.5 text-white/70 transition hover:bg-white/10 hover:text-white"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
      ) : null}

      <header className="flex h-[56px] items-center justify-between border-b border-border-subtle pr-4">
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
            aria-label="Abrir em janela separada"
            title="Abrir em janela separada"
            className="rounded-md p-2 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={isFloating ? onDock : floatPanel}
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
    </aside>
  );
}
