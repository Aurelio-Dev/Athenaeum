import { useMemo, useState } from "react";
import { keyboardShortcutGroups } from "./keyboardShortcuts";

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

export function KeyboardShortcutsSettings() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

  const filteredGroups = useMemo(
    () => keyboardShortcutGroups
      .map((group) => ({
        ...group,
        shortcuts: group.shortcuts.filter((shortcut) => {
          if (!normalizedQuery) {
            return true;
          }

          return [group.category, shortcut.action, shortcut.description, ...shortcut.keys]
            .join(" ")
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedQuery);
        }),
      }))
      .filter((group) => group.shortcuts.length > 0),
    [normalizedQuery],
  );

  return (
    <section className="flex max-w-[620px] flex-col gap-4">
      <header>
        <h2 className="font-serif text-xl font-medium text-text-primary">Atalhos do teclado</h2>
        <p className="mt-1 text-xs leading-5 text-text-secondary">Comandos que já estão disponíveis no Leitor, nos Cadernos e nos Quadros.</p>
      </header>

      <label className="flex h-10 items-center gap-2 rounded-xl border border-border-subtle bg-surface-panel px-3 text-text-secondary focus-within:border-primary focus-within:text-primary">
        <SearchIcon />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Pesquisar atalhos"
          className="min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-subtle"
        />
      </label>

      <div className="flex flex-col gap-4">
        {filteredGroups.map((group) => (
          <section key={group.category} className="overflow-hidden rounded-xl border border-border-subtle bg-surface-card shadow-card">
            <h3 className="border-b border-border-subtle bg-surface-muted px-4 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-text-secondary">
              {group.category}
            </h3>
            <div className="divide-y divide-border-subtle">
              {group.shortcuts.map((shortcut) => (
                <div key={`${group.category}-${shortcut.action}`} className="flex items-center justify-between gap-5 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-primary">{shortcut.action}</p>
                    <p className="mt-0.5 text-xs leading-5 text-text-secondary">{shortcut.description}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {shortcut.keys.map((key, index) => key === "ou" ? (
                      <span key={`${key}-${index}`} className="px-0.5 text-[10px] text-text-subtle">ou</span>
                    ) : (
                      <kbd key={`${key}-${index}`} className="rounded-md border border-border-subtle bg-surface-panel px-2 py-1 font-mono text-[11px] font-semibold text-text-secondary shadow-sm">
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {filteredGroups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-subtle px-5 py-10 text-center text-sm text-text-secondary">
            Nenhum atalho encontrado.
          </div>
        ) : null}
      </div>
    </section>
  );
}
