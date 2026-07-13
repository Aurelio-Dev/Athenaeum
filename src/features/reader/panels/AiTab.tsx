import { useState } from "react";
import { SendIcon } from "./readerPanelIcons";

type Message = {
  id: string;
  role: "user" | "ai";
  text: string;
};

export function AiTab() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "ai",
      text: "Funcionalidade de AI em desenvolvimento.",
    },
  ]);
  const [prompt, setPrompt] = useState("");

  function submitPrompt() {
    const question = prompt.trim();
    if (question.length === 0) {
      return;
    }

    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: question },
      { id: crypto.randomUUID(), role: "ai", text: "Funcionalidade de AI em desenvolvimento." },
    ]);
    setPrompt("");
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <div className="max-w-[82%] rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-sm leading-6 text-white">
                {message.text}
              </div>
            </div>
          ) : (
            <div key={message.id} className="max-w-[86%]">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--muted-foreground)]">ATHENAEUM AI</div>
              <div className="rounded-2xl rounded-tl-md bg-[var(--card)] px-4 py-3 text-sm leading-6 text-[var(--foreground)] shadow-sm ring-1 ring-border-subtle">
                {message.text}
              </div>
            </div>
          ),
        )}
      </div>

      <div className="border-t border-border-subtle p-4">
        <div className="flex items-center gap-2 rounded-full border border-border-subtle bg-[var(--background)] px-4 py-2">
          <input
            type="text"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitPrompt();
              }
            }}
            placeholder="Pergunte algo sobre este documento..."
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
          />
          <button
            type="button"
            aria-label="Enviar pergunta"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={prompt.trim().length === 0}
            onClick={submitPrompt}
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
