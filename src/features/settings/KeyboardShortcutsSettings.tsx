import { useEffect, useMemo, useState } from "react";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import {
  captureBinding,
  findShortcut,
  formatBindingKeys,
  keyboardShortcutGroups,
  type BindingRejection,
  type KeyboardShortcut,
} from "../../lib/keyboardShortcuts";

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function mensagemDaRejeicao(rejeicao: BindingRejection): string {
  switch (rejeicao.reason) {
    case "reserved":
      return "Essa combinação é reservada pelo Windows e nunca chegaria ao Athenaeum.";
    case "needs-modifier":
      return "Este atalho precisa manter Ctrl ou Alt para não disparar durante a digitação.";
    case "conflict":
      return `Já usado por “${findShortcut(rejeicao.conflictId)?.action ?? rejeicao.conflictId}”.`;
    case "invalid":
      return "Use uma letra, um número ou uma tecla de função.";
  }
}

function TeclaVisual({ children }: { children: string }) {
  return children === "ou" ? (
    <span className="px-0.5 text-[10px] text-text-subtle">ou</span>
  ) : (
    <kbd className="rounded-md border border-border-subtle bg-surface-panel px-2 py-1 font-mono text-[11px] font-semibold text-text-secondary shadow-sm">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsSettings() {
  const { bindings, overrides, setShortcutBinding, resetShortcutBinding, resetAllShortcutBindings } =
    useKeyboardShortcuts();
  const [query, setQuery] = useState("");
  const [capturandoId, setCapturandoId] = useState<string | null>(null);
  const [rejeicao, setRejeicao] = useState<BindingRejection | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");

  // Teclas exibidas: o padrao do catalogo para os fixos, o binding efetivo
  // para os remapeaveis.
  function teclasDe(shortcut: KeyboardShortcut): string[] {
    const binding = bindings[shortcut.id];
    return shortcut.defaultBinding && binding ? formatBindingKeys(binding) : [...shortcut.keys];
  }

  // A captura roda na fase de CAPTURA da janela e interrompe a propagacao:
  // sem isso, gravar Ctrl+S salvaria um Caderno aberto no mesmo instante.
  useEffect(() => {
    if (capturandoId === null) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.key === "Escape") {
        setCapturandoId(null);
        setRejeicao(null);
        return;
      }

      const binding = captureBinding(event);
      if (!binding) {
        // Ainda so um modificador pressionado: segue esperando o acorde.
        return;
      }

      const recusa = setShortcutBinding(capturandoId as string, binding);
      setRejeicao(recusa);
      if (!recusa) {
        setCapturandoId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [capturandoId, setShortcutBinding]);

  const filteredGroups = useMemo(
    () => keyboardShortcutGroups
      .map((group) => ({
        ...group,
        shortcuts: group.shortcuts.filter((shortcut) => {
          if (!normalizedQuery) {
            return true;
          }

          const binding = bindings[shortcut.id];
          const teclas = shortcut.defaultBinding && binding
            ? formatBindingKeys(binding)
            : [...shortcut.keys];
          return [group.category, shortcut.action, shortcut.description, ...teclas]
            .join(" ")
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedQuery);
        }),
      }))
      .filter((group) => group.shortcuts.length > 0),
    [bindings, normalizedQuery],
  );

  const temPersonalizacao = Object.keys(overrides).length > 0;

  return (
    <section className="flex max-w-[680px] flex-col gap-4">
      <header>
        <h2 className="app-title font-serif text-xl font-medium">Atalhos do teclado</h2>
        <p className="mt-1 text-xs leading-5 text-text-secondary">
          Comandos disponíveis no Leitor, nos Cadernos e nos Quadros. Os que têm lápis podem ser
          alterados; os demais são fixos porque carregam navegação ou aceitam mais de uma tecla.
        </p>
      </header>

      <label className="flex h-10 items-center gap-2 rounded-xl border border-border-subtle bg-surface-panel px-3 text-text-secondary focus-within:border-primary focus-within:text-primary-text">
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
              {group.shortcuts.map((shortcut) => {
                const remapeavel = shortcut.defaultBinding !== undefined;
                const capturando = capturandoId === shortcut.id;
                const personalizado = shortcut.id in overrides;

                return (
                  <div key={shortcut.id} className="flex items-center justify-between gap-5 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary">{shortcut.action}</p>
                      <p className="mt-0.5 text-xs leading-5 text-text-secondary">
                        {capturando && rejeicao
                          ? mensagemDaRejeicao(rejeicao)
                          : shortcut.description}
                      </p>
                      {personalizado && !capturando ? (
                        <button
                          type="button"
                          onClick={() => resetShortcutBinding(shortcut.id)}
                          className="mt-1 text-xs font-semibold text-primary-text underline underline-offset-2"
                        >
                          Restaurar padrão
                        </button>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {capturando ? (
                        <span
                          role="status"
                          className="rounded-md border border-dashed border-primary px-2 py-1 text-[11px] font-semibold text-primary-text"
                        >
                          Pressione a combinação… Esc cancela
                        </span>
                      ) : (
                        teclasDe(shortcut).map((key, index) => (
                          <TeclaVisual key={`${shortcut.id}-${key}-${index}`}>{key}</TeclaVisual>
                        ))
                      )}

                      {remapeavel ? (
                        <button
                          type="button"
                          aria-label={`Alterar o atalho: ${shortcut.action}`}
                          title="Alterar atalho"
                          aria-pressed={capturando}
                          onClick={() => {
                            setRejeicao(null);
                            setCapturandoId(capturando ? null : shortcut.id);
                          }}
                          className={`ml-1 inline-flex h-7 w-7 items-center justify-center rounded-md border transition ${
                            capturando
                              ? "border-primary text-primary-text"
                              : "border-border-subtle text-text-secondary hover:border-primary hover:text-primary-text"
                          }`}
                        >
                          <PencilIcon />
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {filteredGroups.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border-subtle px-5 py-10 text-center text-sm text-text-secondary">
            Nenhum atalho encontrado.
          </div>
        ) : null}
      </div>

      <button
        type="button"
        disabled={!temPersonalizacao}
        onClick={resetAllShortcutBindings}
        className="self-start rounded-lg border border-border-subtle bg-surface-panel px-3 py-2 text-xs font-semibold text-text-secondary transition hover:border-primary hover:text-primary-text disabled:cursor-not-allowed disabled:opacity-40"
      >
        Restaurar todos os atalhos
      </button>
    </section>
  );
}
