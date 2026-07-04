import { useCallback, useEffect, useRef, useState } from "react";
import { findEnclosingTag, toggleWrapTag, wrapSelectionInCode } from "../richTextShared";

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
  { action: "code", label: "</>", title: "Bloco de codigo" },
];

// Acoes cobertas diretamente pela API nativa de edicao do browser. Bloco de
// codigo nao tem comando nativo — e tratado a parte, envolvendo a selecao num
// <code> em bloco (ver wrapSelectionInCode).
// Sub/sobrescrito tambem ficam fora: o comando nativo pode ANINHAR <sub><sub>
// em cliques repetidos (cada camada encolhe a fonte de novo), entao usam o
// toggle manual de toggleWrapTag.
const execCommandByAction: Partial<Record<FormatAction, string>> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strike: "strikeThrough",
};

function isNotesEmpty(notesText: string) {
  return notesText.replace(/<[^>]*>/g, "").replace(/ /g, " ").trim().length === 0;
}

export function NotesTab({ notesText, onNotesChange, onBlur }: NotesTabProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>(notesText);
  const [hasSelection, setHasSelection] = useState(false);
  const [activeFormats, setActiveFormats] = useState<Set<FormatAction>>(new Set());

  const syncSelectionState = useCallback(() => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    const isSelectionInEditor = Boolean(
      editor &&
        selection &&
        selection.rangeCount > 0 &&
        !selection.isCollapsed &&
        selection.anchorNode &&
        selection.focusNode &&
        editor.contains(selection.anchorNode) &&
        editor.contains(selection.focusNode),
    );

    setHasSelection(isSelectionInEditor);

    if (!isSelectionInEditor) {
      setActiveFormats(new Set());
      return;
    }

    // O execCommand nativo ja faz toggle; queryCommandState informa quais
    // formatos cobrem a selecao atual para o botao refletir isso. Codigo inline
    // fica de fora: nao ha comando nativo correspondente.
    const nextActive = new Set<FormatAction>();
    (Object.keys(execCommandByAction) as FormatAction[]).forEach((action) => {
      const command = execCommandByAction[action];
      if (command && document.queryCommandState(command)) {
        nextActive.add(action);
      }
    });

    // Sub/sobrescrito e codigo inline nao usam execCommand (ver toggleWrapTag e
    // wrapSelectionInCode), entao o estado ativo deles vem de uma busca direta
    // na arvore da selecao.
    if (editor && selection) {
      if (findEnclosingTag(selection.anchorNode, "sub", editor)) {
        nextActive.add("sub");
      }
      if (findEnclosingTag(selection.anchorNode, "sup", editor)) {
        nextActive.add("sup");
      }
      if (findEnclosingTag(selection.anchorNode, "code", editor)) {
        nextActive.add("code");
      }
    }

    setActiveFormats(nextActive);
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

    // Se o usuario apagou todo o texto, tags de formatacao vazias podem
    // sobrar no DOM (ex.: <code></code>), fazendo o proximo caractere
    // digitado herdar aquela formatacao sem o usuario ter escolhido isso.
    // Limpar o editor por completo restaura o estado "em branco" real.
    if (editor.textContent?.trim().length === 0) {
      editor.innerHTML = "";
      editor.focus();

      // execCommand("removeFormat") so tem efeito com uma SELECAO NAO
      // COLAPSADA (algo realmente selecionado). Com o cursor apenas
      // piscando num editor vazio, o comando nao faz nada e o "estilo
      // de digitacao" interno do browser (ex.: proximo caractere sai em
      // negrito) continua ativo. O truque: criar um no de texto
      // temporario, seleciona-lo por inteiro, aplicar removeFormat
      // nele, e entao remove-lo, deixando o editor limpo de verdade.
      const temporaryAnchor = document.createTextNode("\u200B");
      editor.appendChild(temporaryAnchor);

      const anchorRange = document.createRange();
      anchorRange.selectNodeContents(temporaryAnchor);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(anchorRange);

      document.execCommand("removeFormat", false);

      editor.innerHTML = "";
      const finalRange = document.createRange();
      finalRange.selectNodeContents(editor);
      finalRange.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(finalRange);

      setActiveFormats(new Set());
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
      wrapSelectionInCode(selection, editor);
    } else if (action === "sub" || action === "sup") {
      toggleWrapTag(selection, action, editor);
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

  // Enter insere uma quebra de linha simples (<br>) via execCommand, em vez
  // de deixar o browser criar um novo bloco (<div>) \u2014 um bloco novo herdaria
  // o padding/border-radius de uma formatacao ativa como <code> em caixas
  // separadas empilhadas, e o browser para de replicar a formatacao apos
  // algumas quebras. insertLineBreak e o MESMO comando nativo que ja roda
  // corretamente quando o usuario aperta Shift+Enter (o cursor fica visivel
  // e correto porque o proprio browser gerencia a posicao, sem manipulacao
  // manual de Range). Shift/Ctrl/Meta/Alt+Enter caem no comportamento padrao.
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    event.preventDefault();
    document.execCommand("insertLineBreak", false);
    emitChange();
  }

  return (
    <div className="relative h-full">
      {hasSelection ? (
        <div
          className="absolute right-5 top-20 z-10 flex items-center gap-1 rounded-xl bg-[var(--surface-elevated)] px-3 py-2 text-sm font-bold shadow-2xl ring-1 ring-white/10"
          onMouseDownCapture={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {formatButtons.map((button, index) => (
            <div key={button.action} className="flex items-center gap-1">
              {index === 4 || index === 6 ? <span className="mx-1 h-6 w-px bg-white/10" /> : null}
              <button
                type="button"
                className={`min-w-7 rounded-md px-2 py-1 transition ${
                  activeFormats.has(button.action)
                    ? "bg-primary text-white"
                    : "text-[#9E8878] hover:bg-white/5 hover:text-white"
                }`}
                title={button.title}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
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
        onKeyDown={handleKeyDown}
        onKeyUp={syncSelectionState}
        className="h-full w-full overflow-y-auto whitespace-pre-wrap break-words border-0 bg-transparent px-5 py-6 text-sm leading-7 text-[var(--foreground)] outline-none"
      />
    </div>
  );
}
