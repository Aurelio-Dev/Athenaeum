export type AiCitation = {
  page: number;
  excerpt: string;
};

export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citation?: AiCitation;
};

export type AiThreadStatus = "ready" | "generating" | "error";

type AiThreadProps = {
  messages: AiMessage[];
  status: AiThreadStatus;
  onSuggestion: (suggestion: string) => void;
  onJumpToPage: (page: number) => void;
  onStop: () => void;
  onRetry: () => void;
};

const suggestions = [
  "Resumir esta página",
  "Explicar a seleção",
  "Listar conceitos-chave",
] as const;

export function AiThread({ messages, status, onSuggestion, onJumpToPage, onStop, onRetry }: AiThreadProps) {
  const isEmpty = messages.length === 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
      {isEmpty && status === "ready" ? (
        <section aria-label="Sugestões de perguntas" className="flex h-full min-h-56 flex-col items-center justify-center text-center">
          <p className="text-sm font-semibold text-[var(--foreground)]">Como posso ajudar com este PDF?</p>
          <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--muted-foreground)]">
            Escolha uma sugestão ou escreva sua própria pergunta.
          </p>
          <div className="mt-4 flex max-w-md flex-wrap justify-center gap-2">
            {suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => onSuggestion(suggestion)}
                className="rounded-full border border-border-strong bg-[var(--background)] px-3 py-2 text-xs font-medium text-[var(--foreground)] transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {messages.length > 0 ? (
        <div className="space-y-5">
          {messages.map((message) =>
            message.role === "user" ? (
              <article key={message.id} className="ml-5 border-l-[3px] border-primary pl-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Você</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground)]">{message.text}</p>
              </article>
            ) : (
              <article key={message.id} className="pr-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted-foreground)]">Athenaeum IA</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--foreground)]">{message.text}</p>
                {message.citation ? (
                  <div className="mt-3 rounded-lg border border-border-subtle bg-[var(--background)] px-4 py-3">
                    <blockquote className="font-serif text-sm italic leading-6 text-[var(--muted-foreground)]">
                      “{message.citation.excerpt}”
                    </blockquote>
                    <button
                      type="button"
                      aria-label={`Ir para a página ${message.citation.page}`}
                      onClick={() => {
                        if (message.citation) {
                          onJumpToPage(message.citation.page);
                        }
                      }}
                      className="mt-2 rounded-full border border-border-strong bg-[var(--card)] px-2.5 py-1 text-xs font-semibold text-[var(--foreground)] transition hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                    >
                      p. {message.citation.page}
                    </button>
                  </div>
                ) : null}
              </article>
            ),
          )}
        </div>
      ) : null}

      {status === "generating" ? (
        <div role="status" className="mt-5 flex items-center justify-between gap-4 rounded-lg border border-border-subtle bg-[var(--background)] px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-[var(--foreground)]">
            <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
            Gerando resposta simulada...
          </span>
          <button type="button" onClick={onStop} className="text-xs font-bold text-primary hover:underline">
            Parar
          </button>
        </div>
      ) : null}

      {status === "error" ? (
        <div role="alert" className="mt-5 rounded-lg border border-status-red/30 bg-status-red px-4 py-3 text-sm text-status-red-text">
          <p>Não foi possível concluir a resposta simulada.</p>
          <button type="button" onClick={onRetry} className="mt-2 text-xs font-bold underline underline-offset-2">
            Tentar novamente
          </button>
        </div>
      ) : null}
    </div>
  );
}
