export function LocalAiSettings() {
  return (
    <section className="flex max-w-[580px] flex-col gap-4">
      <header>
        <h2 className="font-serif text-xl font-medium text-text-primary">Use sua IA</h2>
        <p className="mt-1 text-xs leading-5 text-text-secondary">Prepare o Athenaeum para trabalhar com um modelo executado no seu computador.</p>
      </header>

      <div className="rounded-xl border border-border-subtle bg-surface-card p-5 shadow-card">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-[0.12em] text-primary">Somente IA local</span>
        </div>
        <h3 className="mt-4 text-base font-semibold text-text-primary">Modelo local</h3>
        <p className="mt-1 max-w-md text-sm leading-6 text-text-secondary">
          Esta área será usada para conectar um modelo local sem enviar documentos para serviços externos.
        </p>

        <div className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-border-subtle bg-surface-muted px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-text-primary">Nenhum modelo configurado</p>
            <p className="mt-0.5 text-xs text-text-secondary">A configuração estará disponível em uma próxima etapa.</p>
          </div>
          <span className="shrink-0 rounded-full bg-surface-panel px-3 py-1 text-xs font-semibold text-text-secondary">Em breve</span>
        </div>
      </div>
    </section>
  );
}
