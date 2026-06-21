import { TagBadge } from "../../../components/TagBadge";
import type { LibraryDocument } from "../../../types/library";

type NotesTabProps = {
  document: LibraryDocument;
  notesText: string;
  onNotesChange: (notes: string) => void;
  progress: number;
};

function formatAuthors(authors: string[]) {
  return authors.length > 4 ? `${authors.slice(0, 4).join(", ")} et al.` : authors.join(", ");
}

// Aba "Notas": informacoes do documento + notas livres (campo unico do
// documento, persistido em documents.notes) + progresso.
export function NotesTab({ document, notesText, onNotesChange, progress }: NotesTabProps) {
  return (
    <div className="px-5 py-5">
      <div className="rounded-lg border border-border-subtle bg-surface-card p-4">
        <h3 className="font-semibold text-text-primary">{document.title}</h3>
        <p className="mt-2 text-sm text-text-secondary">
          {formatAuthors(document.authors)} - {document.year}
        </p>
      </div>

      {document.tags.length > 0 ? (
        <div className="mt-5">
          <p className="text-xs font-bold uppercase tracking-wider text-text-subtle">Tags</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {document.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        </div>
      ) : null}

      <label className="mt-6 block">
        <span className="text-xs font-bold uppercase tracking-wider text-text-subtle">Notas</span>
        <textarea
          className="mt-3 h-64 w-full resize-none rounded-lg border border-border-muted bg-surface-panel px-4 py-3 text-sm leading-6 text-text-primary outline-none focus:border-primary"
          value={notesText}
          placeholder="Escreva suas anotacoes sobre este PDF. Elas serao salvas automaticamente."
          onChange={(event) => onNotesChange(event.target.value)}
        />
      </label>

      <div className="mt-6">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Progresso geral</span>
          <span className="font-bold text-primary">{progress}%</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>
  );
}
