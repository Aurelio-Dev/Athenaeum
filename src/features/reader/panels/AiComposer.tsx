import { useLayoutEffect, useRef, type KeyboardEvent } from "react";
import { SendIcon } from "./readerPanelIcons";

const composerMaxHeight = 120;

type AiComposerProps = {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function AiComposer({ value, disabled, onChange, onSubmit }: AiComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, composerMaxHeight)}px`;
    textarea.style.overflowY = textarea.scrollHeight > composerMaxHeight ? "auto" : "hidden";
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    if (!disabled && value.trim().length > 0) {
      onSubmit();
    }
  }

  return (
    <div className="shrink-0 border-t border-border-subtle bg-[var(--card)] p-4">
      <div className="flex items-end gap-2 rounded-xl border border-border-subtle bg-[var(--background)] px-3 py-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          aria-label="Pergunta para a IA"
          placeholder="Pergunte algo sobre este documento..."
          className="min-h-6 max-h-[120px] min-w-0 flex-1 resize-none bg-transparent py-1 text-sm leading-6 text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:cursor-wait disabled:opacity-60"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          aria-label="Enviar pergunta"
          disabled={disabled || value.trim().length === 0}
          onClick={onSubmit}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SendIcon />
        </button>
      </div>
      <p className="mt-2 text-center text-[11px] text-[var(--muted-foreground)]">
        Enter envia · Shift+Enter cria uma nova linha
      </p>
    </div>
  );
}
