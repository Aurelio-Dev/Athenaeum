import { useRef, useState } from "react";

type NotesTabProps = {
  notesText: string;
  onNotesChange: (notes: string) => void;
  onBlur: () => void;
};

type FormatAction = "bold" | "italic" | "underline" | "strike" | "sub" | "sup" | "code";

const formatButtons: Array<{ action: FormatAction; label: string; title: string }> = [
  { action: "bold", label: "B", title: "Negrito" },
  { action: "italic", label: "I", title: "Italico" },
  { action: "underline", label: "U", title: "Sublinhado" },
  { action: "strike", label: "S", title: "Tachado" },
  { action: "sub", label: "T1", title: "Subscrito" },
  { action: "sup", label: "T2", title: "Sobrescrito" },
  { action: "code", label: "</>", title: "Codigo inline" },
];

function wrapSelection(action: FormatAction, selectedText: string) {
  if (action === "bold") {
    return `**${selectedText}**`;
  }
  if (action === "italic") {
    return `_${selectedText}_`;
  }
  if (action === "underline") {
    return `<u>${selectedText}</u>`;
  }
  if (action === "strike") {
    return `~~${selectedText}~~`;
  }
  if (action === "sub") {
    return `<sub>${selectedText}</sub>`;
  }
  if (action === "sup") {
    return `<sup>${selectedText}</sup>`;
  }
  return `\`${selectedText}\``;
}

export function NotesTab({ notesText, onNotesChange, onBlur }: NotesTabProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  function syncSelectionState() {
    const textarea = textareaRef.current;
    setHasSelection(Boolean(textarea && textarea.selectionStart !== textarea.selectionEnd));
  }

  function applyFormat(action: FormatAction) {
    const textarea = textareaRef.current;
    if (!textarea || textarea.selectionStart === textarea.selectionEnd) {
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = notesText.slice(start, end);
    const replacement = wrapSelection(action, selectedText);
    const nextNotes = `${notesText.slice(0, start)}${replacement}${notesText.slice(end)}`;
    onNotesChange(nextNotes);

    window.requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + replacement.length);
      syncSelectionState();
    });
  }

  return (
    <div className="relative h-full">
      {hasSelection ? (
        <div className="absolute right-5 top-20 z-10 flex items-center gap-1 rounded-xl bg-[var(--surface-elevated)] px-3 py-2 text-sm font-bold shadow-2xl ring-1 ring-white/10">
          {formatButtons.map((button, index) => (
            <div key={button.action} className="flex items-center gap-1">
              {(index === 4 || index === 6) ? <span className="mx-1 h-6 w-px bg-white/10" /> : null}
              <button
                type="button"
                className="min-w-7 rounded-md px-2 py-1 text-[#9E8878] transition hover:bg-white/5 hover:text-white"
                title={button.title}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyFormat(button.action)}
              >
                {button.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        value={notesText}
        onChange={(event) => onNotesChange(event.target.value)}
        onBlur={onBlur}
        onMouseUp={syncSelectionState}
        onKeyUp={syncSelectionState}
        onSelect={syncSelectionState}
        placeholder="Anotações gerais sobre este documento..."
        className="h-full w-full resize-none border-0 bg-transparent px-5 py-6 text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}
