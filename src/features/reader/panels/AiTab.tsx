// Aba "IA": APENAS placeholder visual — cartao com texto + input desabilitado,
// em tom Slate. Sem nenhuma logica de IA / nenhuma integracao real.

function SparkleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </svg>
  );
}

export function AiTab() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-status-slate text-status-slate-text">
          <SparkleIcon />
        </div>
        <h3 className="mt-4 text-base font-semibold text-text-primary">Perguntar a IA</h3>
        <p className="mt-2 max-w-[260px] text-sm text-text-secondary">
          Em breve voce podera fazer perguntas sobre este documento e receber respostas com base no conteudo.
        </p>
        <span className="mt-4 rounded-full bg-status-slate px-3 py-1 text-xs font-bold text-status-slate-text">Em breve</span>
      </div>

      {/* Input puramente decorativo e desabilitado. */}
      <div className="border-t border-border-subtle p-4">
        <div className="flex items-center gap-2 rounded-lg border border-border-muted bg-surface-muted px-3 py-2">
          <input
            type="text"
            disabled
            placeholder="Pergunte algo sobre o documento..."
            className="min-w-0 flex-1 cursor-not-allowed bg-transparent text-sm text-status-slate-text placeholder:text-text-subtle outline-none"
          />
          <button type="button" disabled aria-label="Enviar (em breve)" className="cursor-not-allowed rounded-md p-1.5 text-status-slate-text">
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
