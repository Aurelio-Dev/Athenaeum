import { useCallback, useEffect, useRef, useState } from "react";

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

// Acoes cobertas diretamente pela API nativa de edicao do browser. Codigo inline
// nao tem comando nativo — e tratado a parte, envolvendo a selecao num <code>.
const execCommandByAction: Partial<Record<FormatAction, string>> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikeThrough",
  sub: "subscript",
  sup: "superscript",
};

// Estilo inline no proprio <code> para o trecho renderizar igual mesmo depois de
// recarregar do banco (o innerHTML salvo carrega o estilo junto, sem depender de
// CSS externo). Fundo escuro, monospace, sem syntax highlighting.
const codeInlineStyle =
  "background:#1E2130;color:#F0E6DC;font-family:'IBM Plex Mono',Consolas,monospace;font-size:0.85em;padding:0.1em 0.35em;border-radius:4px;";

function isNotesEmpty(notesText: string) {
  return notesText.replace(/<[^>]*>/g, "").replace(/ /g, " ").trim().length === 0;
}

function wrapSelectionInCode(selection: Selection) {
  const range = selection.getRangeAt(0);
  const code = document.createElement("code");
  code.setAttribute("style", codeInlineStyle);

  try {
    range.surroundContents(code);
  } catch {
    // surroundContents falha quando a selecao cruza fronteiras de elementos;
    // nesse caso extraimos o conteudo e o reinserimos dentro do <code>.
    code.appendChild(range.extractContents());
    range.insertNode(code);
  }

  selection.removeAllRanges();
  const nextRange = document.createRange();
  nextRange.selectNodeContents(code);
  selection.addRange(nextRange);
}

export function NotesTab({ notesText, onNotesChange, onBlur }: NotesTabProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>(notesText);
  const [hasSelection, setHasSelection] = useState(false);

  const syncSelectionState = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();

    setHasSelection(
      Boolean(
        editor &&
          selection &&
          selection.rangeCount > 0 &&
          !selection.isCollapsed &&
          selection.anchorNode &&
          selection.focusNode &&
          editor.contains(selection.anchorNode) &&
          editor.contains(selection.focusNode),
      ),
    );
  }, []);

  // Carrega o HTML inicial no contentEditable uma vez.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor) {
      editor.innerHTML = notesText;
    }
    // Intencional: so no mount. Atualizacoes externas sao tratadas abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Atualizacoes EXTERNAS de notesText (ex.: trocar de documento) reescrevem o
  // editor. Mudancas vindas da propria digitacao (iguais ao ultimo emitido) sao
  // ignoradas para nao reposicionar o cursor a cada tecla.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && notesText !== lastEmittedRef.current) {
      editor.innerHTML = notesText;
      lastEmittedRef.current = notesText;
    }
  }, [notesText]);

  useEffect(() => {
    document.addEventListener("selectionchange", syncSelectionState);
    return () => document.removeEventListener("selectionchange", syncSelectionState);
  }, [syncSelectionState]);

  function emitChange() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    lastEmittedRef.current = editor.innerHTML;
    onNotesChange(editor.innerHTML);
  }

  function applyFormat(action: FormatAction) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    editor.focus();
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }

    if (action === "code") {
      wrapSelectionInCode(selection);
    } else {
      const command = execCommandByAction[action];
      if (command) {
        document.execCommand(command, false);
      }
    }

    emitChange();
    syncSelectionState();
  }

  // Cola apenas texto puro: evita injetar markup/scripts arbitrarios no HTML
  // salvo (sanitizacao pratica sem biblioteca externa).
  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    emitChange();
  }

  return (
    <div className="relative h-full">
      {hasSelection ? (
        <div className="absolute right-5 top-20 z-10 flex items-center gap-1 rounded-xl bg-[var(--surface-elevated)] px-3 py-2 text-sm font-bold shadow-2xl ring-1 ring-white/10">
          {formatButtons.map((button, index) => (
            <div key={button.action} className="flex items-center gap-1">
              {index === 4 || index === 6 ? <span className="mx-1 h-6 w-px bg-white/10" /> : null}
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

      {isNotesEmpty(notesText) ? (
        <span className="pointer-events-none absolute left-0 top-0 px-5 py-6 text-sm leading-7 text-[var(--muted-foreground)]">
          Anotações gerais sobre este documento...
        </span>
      ) : null}

      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label="Anotações do documento"
        contentEditable
        suppressContentEditableWarning
        onInput={emitChange}
        onBlur={onBlur}
        onPaste={handlePaste}
        onMouseUp={syncSelectionState}
        onKeyUp={syncSelectionState}
        className="h-full w-full overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent px-5 py-6 text-sm leading-7 text-[var(--foreground)] outline-none"
      />
    </div>
  );
}
