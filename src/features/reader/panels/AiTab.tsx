// CASCA VISUAL: esta aba não executa inferência, não lê o conteúdo do PDF e
// não chama rede ou backend. Quando o modelo local existir, a simulação de
// geração deverá ser substituída pela integração real, preservando escopo,
// cancelamento, estados de erro e citações navegáveis definidos nesta interface.
import { useEffect, useRef, useState } from "react";
import { EmptyState } from "../../../components/EmptyState";
import { AiComposer } from "./AiComposer";
import { AiThread, type AiMessage, type AiThreadStatus } from "./AiThread";
import { AiSparklesIcon } from "./readerPanelIcons";

type AiPreviewState = "not_configured" | "ready" | "generating" | "error";
type AiScope = "selection" | "page" | "document";

// Andaime temporário para inspeção visual: troque somente este literal durante
// o desenvolvimento e restaure "not_configured" antes de commitar.
const PREVIEW_STATE: AiPreviewState = "not_configured";
const simulatedGenerationDelay = 1_200;

type AiTabProps = {
  documentId: string;
  currentPage: number;
  hasSelection: boolean;
  onJumpToPage: (page: number) => void;
  // Exclusivo para testes automatizados; não representa configuração de produto.
  initialPreviewState?: AiPreviewState;
};

function PreviewEmptyIcon({ className }: { className?: string }) {
  return (
    <span className={`flex items-center justify-center text-[var(--color-sidebar-muted)] ${className ?? ""}`} aria-hidden="true">
      <AiSparklesIcon size={42} />
    </span>
  );
}

function getInitialThread(previewState: AiPreviewState): { messages: AiMessage[]; status: AiThreadStatus } {
  if (previewState === "generating") {
    return {
      messages: [{ id: "preview-question", role: "user", text: "Resumir esta página" }],
      status: "generating",
    };
  }

  if (previewState === "error") {
    return {
      messages: [{ id: "preview-question", role: "user", text: "Listar conceitos-chave" }],
      status: "error",
    };
  }

  return { messages: [], status: "ready" };
}

export function AiTab({
  documentId,
  currentPage,
  hasSelection,
  onJumpToPage,
  initialPreviewState = PREVIEW_STATE,
}: AiTabProps) {
  const initialThread = getInitialThread(initialPreviewState);
  const [scope, setScope] = useState<AiScope>("page");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<AiMessage[]>(initialThread.messages);
  const [status, setStatus] = useState<AiThreadStatus>(initialThread.status);
  const generationTimerRef = useRef<number | null>(null);
  const messageSequenceRef = useRef(0);
  const isModelConfigured = initialPreviewState !== "not_configured";

  function clearGenerationTimer() {
    if (generationTimerRef.current !== null) {
      window.clearTimeout(generationTimerRef.current);
      generationTimerRef.current = null;
    }
  }

  useEffect(() => {
    clearGenerationTimer();
    const nextThread = getInitialThread(initialPreviewState);
    messageSequenceRef.current = 0;
    setScope("page");
    setPrompt("");
    setMessages(nextThread.messages);
    setStatus(nextThread.status);

    return clearGenerationTimer;
  }, [documentId, initialPreviewState]);

  useEffect(() => {
    if (!hasSelection && scope === "selection") {
      setScope("page");
    }
  }, [hasSelection, scope]);

  function nextMessageId(prefix: string) {
    messageSequenceRef.current += 1;
    return `${prefix}-${messageSequenceRef.current}`;
  }

  function startSimulatedGeneration(citationPage: number) {
    clearGenerationTimer();
    setStatus("generating");
    generationTimerRef.current = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        {
          id: nextMessageId("assistant"),
          role: "assistant",
          text: "Esta é uma resposta simulada para demonstrar a futura experiência da IA local.",
          citation: {
            page: citationPage,
            excerpt: "Trecho simulado do PDF para demonstrar como uma citação será apresentada.",
          },
        },
      ]);
      setStatus("ready");
      generationTimerRef.current = null;
    }, simulatedGenerationDelay);
  }

  function submitPrompt() {
    const question = prompt.trim();
    if (question.length === 0 || status === "generating") {
      return;
    }

    setMessages((current) => [
      ...current,
      { id: nextMessageId("user"), role: "user", text: question },
    ]);
    setPrompt("");
    startSimulatedGeneration(currentPage);
  }

  function stopGeneration() {
    clearGenerationTimer();
    setStatus("ready");
  }

  function retryGeneration() {
    startSimulatedGeneration(currentPage);
  }

  const scopeOptions: Array<{ value: AiScope; label: string; disabled?: boolean; title?: string }> = [
    {
      value: "selection",
      label: "Seleção",
      disabled: !hasSelection,
      title: hasSelection ? undefined : "Selecione um trecho no PDF para usar este escopo.",
    },
    { value: "page", label: `Página ${currentPage}` },
    { value: "document", label: "Documento inteiro" },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--card)]">
      <div role="note" className="flex shrink-0 items-start gap-2 border-b border-border-subtle bg-primary-soft px-4 py-3 text-xs leading-5 text-[var(--foreground)]">
        <span className="mt-0.5 shrink-0 text-primary" aria-hidden="true"><AiSparklesIcon size={16} /></span>
        <p>
          <strong>Prévia da interface.</strong> A integração com IA local ainda não está disponível; nenhuma inferência é executada nesta tela.
        </p>
      </div>

      <div className="flex min-h-11 shrink-0 items-center justify-center border-b border-border-subtle px-4 py-2">
        <span className="sr-only">Escopo</span>
        <div role="radiogroup" aria-label="Escopo da IA" className="inline-flex items-center gap-1 rounded-full border border-border-subtle p-1">
          {scopeOptions.map((option) => {
            const isActive = option.value === scope;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                disabled={option.disabled}
                title={option.title}
                onClick={() => setScope(option.value)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-45 ${
                  isActive ? "bg-primary text-white" : "bg-transparent text-text-secondary hover:text-text-primary"
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {isModelConfigured ? (
        <>
          <AiThread
            messages={messages}
            status={status}
            onSuggestion={setPrompt}
            onJumpToPage={onJumpToPage}
            onStop={stopGeneration}
            onRetry={retryGeneration}
          />
          <AiComposer
            value={prompt}
            disabled={status === "generating"}
            onChange={setPrompt}
            onSubmit={submitPrompt}
          />
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <EmptyState
            icon={PreviewEmptyIcon}
            iconClassName="h-12 w-12"
            title="Configure sua IA local"
            description="A IA do Athenaeum foi planejada para rodar no seu computador, sem enviar documentos para serviços externos."
            verticalPosition="raised"
            action={{
              label: "Configurar em Ajustes",
              onClick: () => undefined,
              disabled: true,
              title: "A abertura direta de Ajustes → Use sua IA ainda não está disponível nesta janela.",
            }}
          />
        </div>
      )}
    </div>
  );
}
