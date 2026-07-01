import { useMemo, useState } from "react";
import type { Annotation } from "../../types/annotation";
import { AiTab } from "./panels/AiTab";
import { AnnotationsTab } from "./panels/AnnotationsTab";
import { NotesTab } from "./panels/NotesTab";

export const readerPanelPopoutStorageKey = "athenaeum:reader-panel-popout";

type PopoutPayload = {
  documentTitle: string;
  notesText: string;
  annotations: Annotation[];
};

type PanelTab = "ai" | "notes" | "annotations";

const tabs: Array<{ id: PanelTab; label: string }> = [
  { id: "ai", label: "Ask AI" },
  { id: "notes", label: "Notas" },
  { id: "annotations", label: "Anotações" },
];

function parsePayload(): PopoutPayload {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(readerPanelPopoutStorageKey) ?? "{}") as Partial<PopoutPayload>;
    return {
      documentTitle: typeof parsed.documentTitle === "string" ? parsed.documentTitle : "Documento",
      notesText: typeof parsed.notesText === "string" ? parsed.notesText : "",
      annotations: Array.isArray(parsed.annotations) ? (parsed.annotations as Annotation[]) : [],
    };
  } catch {
    return { documentTitle: "Documento", notesText: "", annotations: [] };
  }
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

export function ReaderPanelPopout() {
  const payload = useMemo(parsePayload, []);
  const [activeTab, setActiveTab] = useState<PanelTab>("annotations");
  const [notesText, setNotesText] = useState(payload.notesText);

  return (
    <main className="flex h-screen flex-col bg-card text-foreground">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle bg-[var(--surface-header)] px-4">
        <h1 className="min-w-0 truncate text-sm font-bold text-white">Anotações — {payload.documentTitle}</h1>
      </header>

      <div className="flex h-[56px] shrink-0 items-center justify-between border-b border-border-subtle pr-4">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`px-5 py-[18px] text-sm font-semibold ${
                activeTab === tab.id ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button type="button" aria-label="Janela separada" title="Janela separada" className="rounded-md bg-muted p-2 text-muted-foreground">
          <PopOutIcon />
        </button>
      </div>

      <section className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === "notes" ? (
          <NotesTab notesText={notesText} onNotesChange={setNotesText} onBlur={() => undefined} />
        ) : activeTab === "annotations" ? (
          <AnnotationsTab annotations={payload.annotations} onJumpToPage={() => undefined} onDelete={() => undefined} />
        ) : (
          <AiTab />
        )}
      </section>
    </main>
  );
}
