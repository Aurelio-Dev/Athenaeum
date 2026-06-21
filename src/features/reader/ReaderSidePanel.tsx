import { useState } from "react";
import type { Annotation } from "../../types/annotation";
import type { LibraryDocument } from "../../types/library";
import { AiTab } from "./panels/AiTab";
import { AnnotationsTab } from "./panels/AnnotationsTab";
import { NotesTab } from "./panels/NotesTab";

type ReaderTab = "notes" | "annotations" | "ai";

type ReaderSidePanelProps = {
  document: LibraryDocument;
  notesText: string;
  onNotesChange: (notes: string) => void;
  annotations: Annotation[];
  progress: number;
  onJumpToPage: (page: number) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onClose: () => void;
};

const tabs: Array<{ id: ReaderTab; label: string }> = [
  { id: "notes", label: "Notas" },
  { id: "annotations", label: "Anotações" },
  { id: "ai", label: "IA" },
];

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

// Painel lateral direito do leitor, com abas Notas / Anotacoes / IA.
export function ReaderSidePanel({
  document,
  notesText,
  onNotesChange,
  annotations,
  progress,
  onJumpToPage,
  onDeleteAnnotation,
  onClose,
}: ReaderSidePanelProps) {
  const [activeTab, setActiveTab] = useState<ReaderTab>("notes");

  return (
    <aside className="absolute inset-y-0 right-0 z-20 flex w-[326px] max-w-[calc(100vw-32px)] shrink-0 flex-col border-l border-slate-300 bg-surface-panel shadow-2xl lg:relative lg:shadow-none">
      <header className="flex items-center justify-between border-b border-border-subtle pr-2">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`px-4 py-4 text-sm font-semibold ${
                activeTab === tab.id ? "border-b-2 border-primary text-primary" : "text-text-subtle hover:text-text-secondary"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Fechar painel" className="rounded-md p-2 text-text-subtle hover:bg-surface-muted" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "notes" ? (
          <NotesTab document={document} notesText={notesText} onNotesChange={onNotesChange} progress={progress} />
        ) : activeTab === "annotations" ? (
          <AnnotationsTab annotations={annotations} onJumpToPage={onJumpToPage} onDelete={onDeleteAnnotation} />
        ) : (
          <AiTab />
        )}
      </div>
    </aside>
  );
}
